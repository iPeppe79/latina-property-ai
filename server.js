const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  initDb,
  db,
  all,
  get,
  run,
  now
} = require('./db');
const {
  parseCsv,
  rowsToCsv
} = require('./lib/csv');
const {
  estimateMarketPricePerMq,
  scoreVacancy,
  scoreSellerMotivation,
  scoreProperty,
  scoreDemandMatch,
  verdictForProperty,
  deriveCriticalities,
  recommendedAction,
  toList
} = require('./services/scoring');
const { buildReportLines, createSimplePdf } = require('./services/report');

initDb();
rebuildAllMatches();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    // ignore
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function jsonResponse(res, data) {
  res.json({ ok: true, ...data });
}

function normalizeSettingRow(row) {
  return {
    id: row.id,
    provider: row.provider,
    setting_key: row.setting_key,
    setting_label: row.setting_label,
    value: row.value ?? '',
    is_secret: Boolean(row.is_secret),
    notes: row.notes || '',
    source_type: row.source_type,
    source_reference: row.source_reference,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function upsertSetting(payload) {
  const provider = payload.provider || 'General';
  const settingKey = payload.setting_key || payload.key;
  if (!settingKey) {
    return null;
  }
  const settingLabel = payload.setting_label || payload.label || settingKey;
  const value = payload.value ?? '';
  const isSecret = Number(Boolean(payload.is_secret || payload.secret));
  const notes = payload.notes || '';

  run(`
    INSERT INTO app_settings (
      provider, setting_key, setting_label, value, is_secret, notes, source_type, source_reference, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, setting_key) DO UPDATE SET
      setting_label = excluded.setting_label,
      value = excluded.value,
      is_secret = excluded.is_secret,
      notes = excluded.notes,
      source_type = excluded.source_type,
      source_reference = excluded.source_reference,
      updated_at = excluded.updated_at
  `, [
    provider,
    settingKey,
    settingLabel,
    value,
    isSecret,
    notes,
    payload.source_type || 'manual',
    payload.source_reference || 'local-config',
    now(),
    now()
  ]);

  return get('SELECT * FROM app_settings WHERE provider = ? AND setting_key = ?', [provider, settingKey]);
}

function getSettingValue(provider, settingKey, fallback = '') {
  const row = get('SELECT value FROM app_settings WHERE provider = ? AND setting_key = ?', [provider, settingKey]);
  return row ? row.value || fallback : fallback;
}

function mapProperty(row) {
  return {
    ...row,
    demand_count: row.demand_count || 0,
    match_count: row.match_count || 0
  };
}

function buildPropertyContext(propertyId) {
  const property = get('SELECT * FROM properties WHERE id = ?', [propertyId]);
  if (!property) return null;

  const listings = all('SELECT * FROM listings WHERE property_id = ? ORDER BY created_at DESC', [propertyId]);
  const notes = all('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', ['property', propertyId]);
  const events = all('SELECT * FROM property_events WHERE property_id = ? ORDER BY event_date DESC, created_at DESC', [propertyId]);
  const matches = all(`
    SELECT m.*, d.buyer_name, d.target_cities, d.budget_min, d.budget_max, d.surface_min, d.surface_max, d.property_types, d.urgency
    FROM matches m
    JOIN buyer_demands d ON d.id = m.buyer_demand_id
    WHERE m.property_id = ?
    ORDER BY m.match_score DESC
  `, [propertyId]);
  const relatedDemandIds = [...new Set(matches.map((match) => match.buyer_demand_id))];
  const demands = relatedDemandIds.length
    ? all(`SELECT * FROM buyer_demands WHERE id IN (${relatedDemandIds.map(() => '?').join(',')})`, relatedDemandIds)
    : [];
  const tasks = all('SELECT * FROM outreach_tasks WHERE property_id = ? ORDER BY created_at DESC', [propertyId]);
  const sellerLinks = all(`
    SELECT pel.*, e.name, e.phone, e.email, e.entity_type
    FROM property_entity_links pel
    JOIN entities e ON e.id = pel.entity_id
    WHERE pel.property_id = ?
  `, [propertyId]);

  return { property, listings, notes, events, matches, demands, tasks, sellerLinks };
}

function refreshPropertyScores(propertyId) {
  const context = buildPropertyContext(propertyId);
  if (!context) return null;

  const comparables = all('SELECT city, property_type, surface_mq, asking_price FROM properties WHERE id != ?', [propertyId]);
  const marketPricePerMq = estimateMarketPricePerMq(context.property, comparables);
  const vacancyScore = scoreVacancy(context.property, context.listings, context.events, context.notes);
  const sellerMotivationScore = scoreSellerMotivation(context.property, context.events, context.notes);
  const pricePerMq = Number(context.property.surface_mq || 0) > 0
    ? Number(context.property.asking_price || 0) / Number(context.property.surface_mq || 1)
    : 0;
  const propertyForScore = {
    ...context.property,
    price_per_mq: pricePerMq
  };
  const propertyScore = scoreProperty(propertyForScore, marketPricePerMq, vacancyScore, sellerMotivationScore);
  const criticalities = deriveCriticalities({ ...context.property, market_price_per_mq: marketPricePerMq }, context.matches);
  const demandStrength = context.matches.length ? Math.max(...context.matches.map((match) => Number(match.match_score || 0))) : 0;
  const verdict = verdictForProperty({
    matchScore: demandStrength,
    priceCoherenceScore: marketPricePerMq > 0 ? Math.round(100 - Math.abs(pricePerMq - marketPricePerMq) / marketPricePerMq * 120) : 50,
    propertyScore,
    demandStrength
  });
  const recommendation = recommendedAction(verdict, criticalities, sellerMotivationScore);

  run(`
    UPDATE properties
    SET price_per_mq = ?,
        market_price_per_mq = ?,
        property_score = ?,
        vacancy_score = ?,
        seller_motivation_score = ?,
        verdict = ?,
        criticalities = ?,
        recommended_action = ?,
        updated_at = ?
    WHERE id = ?
  `, [
    pricePerMq,
    marketPricePerMq,
    propertyScore,
    vacancyScore,
    sellerMotivationScore,
    verdict,
    JSON.stringify(criticalities),
    recommendation,
    now(),
    propertyId
  ]);

  return {
    property: get('SELECT * FROM properties WHERE id = ?', [propertyId]),
    marketPricePerMq,
    pricePerMq,
    propertyScore,
    vacancyScore,
    sellerMotivationScore,
    verdict,
    criticalities,
    recommendation
  };
}

function rebuildMatchesForProperty(propertyId) {
  const context = buildPropertyContext(propertyId);
  if (!context) return [];

  const property = context.property;
  const demands = all("SELECT * FROM buyer_demands WHERE status = 'attiva'");
  const marketPricePerMq = Number(property.market_price_per_mq || estimateMarketPricePerMq(property, []));
  const pricePerMq = Number(property.surface_mq || 0) > 0 ? Number(property.asking_price || 0) / Number(property.surface_mq || 1) : 0;

  demands.forEach((demand) => {
    const result = scoreDemandMatch({ ...property, price_per_mq: pricePerMq }, demand, marketPricePerMq);
    const demandCities = toList(demand.target_cities).map((item) => item.toLowerCase());
    const demandTypes = toList(demand.property_types).map((item) => item.toLowerCase());
    const cityOk = !demandCities.length || demandCities.includes(String(property.city || '').toLowerCase());
    const typeOk = !demandTypes.length || demandTypes.some((item) => String(property.property_type || '').toLowerCase().includes(item));
    const priceCoherence = result.priceCoherenceScore;
    const verdict = result.matchScore >= 75 && priceCoherence >= 70
      ? 'SÌ'
      : result.matchScore >= 55
        ? 'FORSE'
        : 'NO';
    const rationale = [
      `città=${cityOk ? 'ok' : 'no'}`,
      `tipo=${typeOk ? 'ok' : 'no'}`,
      `match=${result.matchScore}`,
      `coerenza_prezzo=${priceCoherence}`
    ].join('; ');

    run(`
      INSERT INTO matches (
        property_id, buyer_demand_id, match_score, price_coherence_score, demand_fit_score, verdict, rationale,
        status, source_type, source_reference, source_record_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(property_id, buyer_demand_id) DO UPDATE SET
        match_score = excluded.match_score,
        price_coherence_score = excluded.price_coherence_score,
        demand_fit_score = excluded.demand_fit_score,
        verdict = excluded.verdict,
        rationale = excluded.rationale,
        status = excluded.status,
        updated_at = excluded.updated_at
    `, [
      propertyId,
      demand.id,
      result.matchScore,
      result.priceCoherenceScore,
      result.demandFitScore,
      verdict,
      rationale,
      'active',
      'derived',
      'calculated',
      null,
      now(),
      now()
    ]);
  });

  return all(`
    SELECT m.*, d.buyer_name, d.target_cities, d.budget_min, d.budget_max, d.surface_min, d.surface_max, d.property_types
    FROM matches m
    JOIN buyer_demands d ON d.id = m.buyer_demand_id
    WHERE m.property_id = ?
    ORDER BY m.match_score DESC
  `, [propertyId]);
}

function rebuildAllMatches() {
  const properties = all('SELECT id FROM properties');
  properties.forEach((property) => {
    rebuildMatchesForProperty(property.id);
    refreshPropertyScores(property.id);
  });
}

function ensurePropertyDetail(propertyId) {
  const context = buildPropertyContext(propertyId);
  if (!context) return null;
  const computed = refreshPropertyScores(propertyId);
  const matches = rebuildMatchesForProperty(propertyId);
  const tasks = context.tasks;
  const notes = context.notes;
  const property = get('SELECT * FROM properties WHERE id = ?', [propertyId]);
  return { property, matches, tasks, notes, sellerLinks: context.sellerLinks, computed };
}

function readCsvRows(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

app.get('/api/health', (req, res) => {
  jsonResponse(res, { status: 'ok', now: now() });
});

app.get('/api/settings', (req, res) => {
  const settings = all('SELECT * FROM app_settings ORDER BY provider ASC, setting_key ASC').map(normalizeSettingRow);
  jsonResponse(res, { settings });
});

app.put('/api/settings', (req, res) => {
  const payload = req.body || {};
  const input = Array.isArray(payload.settings) ? payload.settings : [payload];
  const updated = [];
  input.forEach((item) => {
    const row = upsertSetting(item);
    if (row) {
      updated.push(normalizeSettingRow(row));
    }
  });
  jsonResponse(res, { updated, count: updated.length });
});

app.get('/api/dashboard', (req, res) => {
  const properties = all(`
    SELECT p.*, COUNT(DISTINCT m.buyer_demand_id) AS match_count
    FROM properties p
    LEFT JOIN matches m ON m.property_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `);
  const demands = all(`
    SELECT d.*, COUNT(m.id) AS matched_properties
    FROM buyer_demands d
    LEFT JOIN matches m ON m.buyer_demand_id = d.id
    GROUP BY d.id
    ORDER BY d.updated_at DESC
  `);
  const tasks = all('SELECT * FROM outreach_tasks ORDER BY created_at DESC LIMIT 20');
  const stats = {
    properties: get('SELECT COUNT(*) AS count FROM properties').count,
    demands: get('SELECT COUNT(*) AS count FROM buyer_demands').count,
    matches: get('SELECT COUNT(*) AS count FROM matches').count,
    tasks: get('SELECT COUNT(*) AS count FROM outreach_tasks').count,
    pendingApprovals: get("SELECT COUNT(*) AS count FROM outreach_tasks WHERE approval_status = 'pending'").count,
    sources: get('SELECT COUNT(*) AS count FROM raw_records').count
  };
  jsonResponse(res, {
    stats,
    properties: properties.map(mapProperty),
    demands,
    tasks
  });
});

app.get('/api/properties', (req, res) => {
  const { city, verdict, q } = req.query;
  const clauses = [];
  const params = [];
  if (city) {
    clauses.push('city = ?');
    params.push(city);
  }
  if (verdict) {
    clauses.push('verdict = ?');
    params.push(verdict);
  }
  if (q) {
    clauses.push('(title LIKE ? OR address LIKE ? OR zone LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = all(`
    SELECT p.*, COUNT(DISTINCT m.buyer_demand_id) AS match_count
    FROM properties p
    LEFT JOIN matches m ON m.property_id = p.id
    ${where}
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `, params);
  jsonResponse(res, { properties: rows.map(mapProperty) });
});

app.get('/api/properties/:id', (req, res) => {
  const detail = ensurePropertyDetail(req.params.id);
  if (!detail) return res.status(404).json({ ok: false, error: 'Immobile non trovato' });

  const property = detail.property;
  const matchSummaries = detail.matches.map((match) => ({ ...match, buyer_name: match.buyer_name }));
  const demandRows = detail.matches.length
    ? all(`SELECT * FROM buyer_demands WHERE id IN (${detail.matches.map(() => '?').join(',')})`, detail.matches.map((match) => match.buyer_demand_id))
    : [];
  jsonResponse(res, {
    property,
    matches: matchSummaries,
    demands: demandRows,
    tasks: detail.tasks,
    notes: detail.notes,
    sellerLinks: detail.sellerLinks,
    computed: detail.computed
  });
});

app.post('/api/properties', (req, res) => {
  const payload = req.body || {};
  const sourceReference = payload.source_reference || 'manual';
  const sourceType = payload.source_type || 'manual';
  const raw = run(`
    INSERT INTO raw_records (
      record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'property',
    payload.source_name || 'manual',
    payload.external_ref || null,
    JSON.stringify(payload),
    now(),
    'imported',
    payload.verification_status || 'da verificare',
    payload.note || 'Inserimento manuale'
  ]);

  const pricePerMq = Number(payload.surface_mq || 0) > 0 ? Number(payload.asking_price || 0) / Number(payload.surface_mq || 1) : 0;
  const vacancyScore = scoreVacancy(payload, [], [], []);
  const sellerMotivationScore = scoreSellerMotivation(payload, [], []);
  const marketPricePerMq = estimateMarketPricePerMq(payload, []);
  const propertyScore = scoreProperty({ ...payload, price_per_mq: pricePerMq }, marketPricePerMq, vacancyScore, sellerMotivationScore);

  const insert = run(`
    INSERT INTO properties (
      external_ref, title, address, city, province, zone, property_type, asking_price, surface_mq,
      rooms, bathrooms, floor, condition_state, energy_class, status, vacancy_status, seller_motivation,
      notes_summary, price_per_mq, market_price_per_mq, property_score, vacancy_score, seller_motivation_score,
      verdict, criticalities, recommended_action, source_type, source_reference, source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.external_ref || null,
    payload.title,
    payload.address,
    payload.city,
    payload.province || 'LT',
    payload.zone || '',
    payload.property_type,
    Number(payload.asking_price || 0),
    Number(payload.surface_mq || 0),
    payload.rooms ? Number(payload.rooms) : null,
    payload.bathrooms ? Number(payload.bathrooms) : null,
    payload.floor || '',
    payload.condition_state || 'da verificare',
    payload.energy_class || 'da verificare',
    payload.status || 'attivo',
    payload.vacancy_status || 'unknown',
    payload.seller_motivation || 'da verificare',
    payload.notes_summary || '',
    pricePerMq,
    marketPricePerMq,
    propertyScore,
    vacancyScore,
    sellerMotivationScore,
    'FORSE',
    JSON.stringify([]),
    'Verifica dati e calibra prezzo',
    sourceType,
    sourceReference,
    raw.lastInsertRowid,
    now(),
    now()
  ]);

  rebuildMatchesForProperty(insert.lastInsertRowid);
  refreshPropertyScores(insert.lastInsertRowid);
  jsonResponse(res, { id: insert.lastInsertRowid });
});

app.post('/api/properties/import-csv', (req, res) => {
  const { csvText, source_name } = req.body || {};
  if (!csvText) {
    return res.status(400).json({ ok: false, error: 'csvText mancante' });
  }

  const rows = readCsvRows(csvText);
  const created = [];
  rows.forEach((row, index) => {
    if (!row.title || !row.address || !row.city || !row.property_type || !row.asking_price || !row.surface_mq) {
      return;
    }
    const payload = {
      ...row,
      asking_price: Number(String(row.asking_price).replace(/[^\d.,-]/g, '').replace(',', '.')),
      surface_mq: Number(String(row.surface_mq).replace(/[^\d.,-]/g, '').replace(',', '.')),
      rooms: row.rooms ? Number(row.rooms) : null,
      bathrooms: row.bathrooms ? Number(row.bathrooms) : null
    };
    const raw = run(`
      INSERT INTO raw_records (
        record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'property_import',
      source_name || 'csv',
      `row-${index + 1}`,
      JSON.stringify(payload),
      now(),
      'imported',
      'da verificare',
      'Import CSV immobili'
    ]);
    const pricePerMq = Number(payload.asking_price || 0) / Math.max(1, Number(payload.surface_mq || 1));
    const vacancyScore = scoreVacancy(payload, [], [], []);
    const sellerMotivationScore = scoreSellerMotivation(payload, [], []);
    const marketPricePerMq = estimateMarketPricePerMq(payload, []);
    const propertyScore = scoreProperty({ ...payload, price_per_mq: pricePerMq }, marketPricePerMq, vacancyScore, sellerMotivationScore);

    const insert = run(`
      INSERT INTO properties (
        external_ref, title, address, city, province, zone, property_type, asking_price, surface_mq,
        rooms, bathrooms, floor, condition_state, energy_class, status, vacancy_status, seller_motivation,
        notes_summary, price_per_mq, market_price_per_mq, property_score, vacancy_score, seller_motivation_score,
        verdict, criticalities, recommended_action, source_type, source_reference, source_record_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      payload.external_ref || `csv-${index + 1}`,
      payload.title,
      payload.address,
      payload.city,
      payload.province || 'LT',
      payload.zone || '',
      payload.property_type,
      payload.asking_price,
      payload.surface_mq,
      payload.rooms || null,
      payload.bathrooms || null,
      payload.floor || '',
      payload.condition_state || 'da verificare',
      payload.energy_class || 'da verificare',
      payload.status || 'attivo',
      payload.vacancy_status || 'unknown',
      payload.seller_motivation || 'da verificare',
      payload.notes_summary || '',
      pricePerMq,
      marketPricePerMq,
      propertyScore,
      vacancyScore,
      sellerMotivationScore,
      'FORSE',
      JSON.stringify([]),
      'Verifica dati e calibra prezzo',
      'csv',
      `csv:${source_name || 'upload'}:row-${index + 1}`,
      raw.lastInsertRowid,
      now(),
      now()
    ]);
    rebuildMatchesForProperty(insert.lastInsertRowid);
    refreshPropertyScores(insert.lastInsertRowid);
    created.push(insert.lastInsertRowid);
  });

  jsonResponse(res, { created: created.length, ids: created });
});

app.put('/api/properties/:id', (req, res) => {
  const payload = req.body || {};
  const current = get('SELECT * FROM properties WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ ok: false, error: 'Immobile non trovato' });

  run(`
    UPDATE properties
    SET external_ref = ?,
        title = ?,
        address = ?,
        city = ?,
        province = ?,
        zone = ?,
        property_type = ?,
        asking_price = ?,
        surface_mq = ?,
        rooms = ?,
        bathrooms = ?,
        floor = ?,
        condition_state = ?,
        energy_class = ?,
        status = ?,
        vacancy_status = ?,
        seller_motivation = ?,
        notes_summary = ?,
        source_type = ?,
        source_reference = ?,
        updated_at = ?
    WHERE id = ?
  `, [
    payload.external_ref || current.external_ref,
    payload.title || current.title,
    payload.address || current.address,
    payload.city || current.city,
    payload.province || current.province,
    payload.zone || current.zone,
    payload.property_type || current.property_type,
    Number(payload.asking_price || current.asking_price),
    Number(payload.surface_mq || current.surface_mq),
    payload.rooms !== undefined ? payload.rooms : current.rooms,
    payload.bathrooms !== undefined ? payload.bathrooms : current.bathrooms,
    payload.floor || current.floor,
    payload.condition_state || current.condition_state,
    payload.energy_class || current.energy_class,
    payload.status || current.status,
    payload.vacancy_status || current.vacancy_status,
    payload.seller_motivation || current.seller_motivation,
    payload.notes_summary || current.notes_summary,
    payload.source_type || current.source_type,
    payload.source_reference || current.source_reference,
    now(),
    req.params.id
  ]);

  refreshPropertyScores(req.params.id);
  rebuildMatchesForProperty(req.params.id);
  jsonResponse(res, { id: Number(req.params.id) });
});

app.post('/api/demands', (req, res) => {
  const payload = req.body || {};
  const raw = run(`
    INSERT INTO raw_records (
      record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'buyer_demand',
    payload.source_name || 'manual',
    payload.email || payload.phone || null,
    JSON.stringify(payload),
    now(),
    'imported',
    payload.verification_status || 'da verificare',
    payload.note || 'Inserimento richiesta cliente'
  ]);

  const insert = run(`
    INSERT INTO buyer_demands (
      entity_id, buyer_name, phone, email, target_cities, budget_min, budget_max, surface_min, surface_max,
      rooms_min, property_types, urgency, financing_status, notes, status, source_type, source_reference,
      source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.entity_id || null,
    payload.buyer_name,
    payload.phone || '',
    payload.email || '',
    JSON.stringify(parseJsonList(payload.target_cities)),
    payload.budget_min ? Number(payload.budget_min) : null,
    payload.budget_max ? Number(payload.budget_max) : null,
    payload.surface_min ? Number(payload.surface_min) : null,
    payload.surface_max ? Number(payload.surface_max) : null,
    payload.rooms_min ? Number(payload.rooms_min) : null,
    JSON.stringify(parseJsonList(payload.property_types)),
    payload.urgency || 'media',
    payload.financing_status || 'da verificare',
    payload.notes || '',
    payload.status || 'attiva',
    payload.source_type || 'manual',
    payload.source_reference || 'manual',
    raw.lastInsertRowid,
    now(),
    now()
  ]);

  rebuildAllMatches();
  jsonResponse(res, { id: insert.lastInsertRowid });
});

app.get('/api/demands', (req, res) => {
  const rows = all(`
    SELECT d.*, COUNT(m.id) AS matched_properties
    FROM buyer_demands d
    LEFT JOIN matches m ON m.buyer_demand_id = d.id
    GROUP BY d.id
    ORDER BY d.updated_at DESC
  `);
  jsonResponse(res, { demands: rows });
});

app.get('/api/demands/:id', (req, res) => {
  const demand = get('SELECT * FROM buyer_demands WHERE id = ?', [req.params.id]);
  if (!demand) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });
  const matches = all(`
    SELECT m.*, p.title, p.city, p.zone, p.property_type, p.asking_price, p.surface_mq
    FROM matches m
    JOIN properties p ON p.id = m.property_id
    WHERE m.buyer_demand_id = ?
    ORDER BY m.match_score DESC
  `, [req.params.id]);
  const notes = all('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', ['buyer_demand', req.params.id]);
  jsonResponse(res, { demand, matches, notes });
});

app.post('/api/entities', (req, res) => {
  const payload = req.body || {};
  const raw = run(`
    INSERT INTO raw_records (
      record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'entity',
    payload.source_name || 'manual',
    payload.email || payload.phone || null,
    JSON.stringify(payload),
    now(),
    'imported',
    payload.verification_status || 'da verificare',
    payload.note || 'Contatto CRM'
  ]);
  const insert = run(`
    INSERT INTO entities (
      entity_type, name, phone, email, company, preferred_channel, status, source_type, source_reference,
      source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.entity_type || 'contact',
    payload.name,
    payload.phone || '',
    payload.email || '',
    payload.company || '',
    payload.preferred_channel || 'da scegliere',
    payload.status || 'attivo',
    payload.source_type || 'manual',
    payload.source_reference || 'manual',
    raw.lastInsertRowid,
    now(),
    now()
  ]);
  jsonResponse(res, { id: insert.lastInsertRowid });
});

app.get('/api/entities', (req, res) => {
  const rows = all('SELECT * FROM entities ORDER BY updated_at DESC');
  jsonResponse(res, { entities: rows });
});

app.post('/api/property-events', (req, res) => {
  const payload = req.body || {};
  const raw = run(`
    INSERT INTO raw_records (
      record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'property_event',
    payload.source_name || 'manual',
    payload.event_type || null,
    JSON.stringify(payload),
    now(),
    'imported',
    payload.verification_status || 'da verificare',
    payload.note || 'Evento immobile'
  ]);
  const insert = run(`
    INSERT INTO property_events (
      property_id, event_type, event_date, detail, source_type, source_reference, source_record_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.property_id,
    payload.event_type,
    payload.event_date || new Date().toISOString().slice(0, 10),
    payload.detail,
    payload.source_type || 'manual',
    payload.source_reference || 'manual',
    raw.lastInsertRowid,
    now(),
    now()
  ]);
  refreshPropertyScores(payload.property_id);
  rebuildMatchesForProperty(payload.property_id);
  jsonResponse(res, { id: insert.lastInsertRowid });
});

app.post('/api/notes', (req, res) => {
  const payload = req.body || {};
  const raw = run(`
    INSERT INTO raw_records (
      record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'note',
    payload.source_name || 'manual',
    payload.entity_type || null,
    JSON.stringify(payload),
    now(),
    'imported',
    payload.verification_status || 'da verificare',
    payload.note || 'Nota CRM'
  ]);
  const insert = run(`
    INSERT INTO notes (
      entity_type, entity_id, note_text, source_type, source_reference, source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.entity_type,
    payload.entity_id,
    payload.note_text,
    payload.source_type || 'manual',
    payload.source_reference || 'manual',
    raw.lastInsertRowid,
    now(),
    now()
  ]);
  jsonResponse(res, { id: insert.lastInsertRowid });
});

app.get('/api/tasks', (req, res) => {
  const tasks = all(`
    SELECT t.*, p.title AS property_title, d.buyer_name
    FROM outreach_tasks t
    LEFT JOIN properties p ON p.id = t.property_id
    LEFT JOIN buyer_demands d ON d.id = t.buyer_demand_id
    ORDER BY t.created_at DESC
  `);
  jsonResponse(res, { tasks });
});

app.post('/api/tasks', (req, res) => {
  const payload = req.body || {};
  const raw = run(`
    INSERT INTO raw_records (
      record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'task',
    payload.source_name || 'derived',
    payload.channel || null,
    JSON.stringify(payload),
    now(),
    'imported',
    payload.verification_status || 'da verificare',
    payload.notes || 'Task CRM'
  ]);
  const insert = run(`
    INSERT INTO outreach_tasks (
      entity_id, property_id, buyer_demand_id, channel, task_type, status, next_action, draft_message,
      approval_status, due_at, notes, source_type, source_reference, source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.entity_id || null,
    payload.property_id || null,
    payload.buyer_demand_id || null,
    payload.channel || 'da scegliere',
    payload.task_type || 'follow_up',
    payload.status || 'draft',
    payload.next_action || 'Verificare dati',
    payload.draft_message || 'Bozza da approvare',
    payload.approval_status || 'pending',
    payload.due_at || null,
    payload.notes || '',
    payload.source_type || 'derived',
    payload.source_reference || 'calculated',
    raw.lastInsertRowid,
    now(),
    now()
  ]);
  jsonResponse(res, { id: insert.lastInsertRowid });
});

app.patch('/api/tasks/:id/approve', (req, res) => {
  const payload = req.body || {};
  run(`
    UPDATE outreach_tasks
    SET approval_status = 'approved',
        status = 'approved',
        approved_at = ?,
        approved_by = ?,
        updated_at = ?
    WHERE id = ?
  `, [
    now(),
    payload.approved_by || 'utente locale',
    now(),
    req.params.id
  ]);
  jsonResponse(res, { id: Number(req.params.id) });
});

app.patch('/api/tasks/:id/status', (req, res) => {
  const payload = req.body || {};
  run(`
    UPDATE outreach_tasks
    SET status = ?,
        approval_status = ?,
        updated_at = ?
    WHERE id = ?
  `, [
    payload.status || 'draft',
    payload.approval_status || 'pending',
    now(),
    req.params.id
  ]);
  jsonResponse(res, { id: Number(req.params.id) });
});

app.post('/api/matches/rebuild', (req, res) => {
  rebuildAllMatches();
  jsonResponse(res, { rebuilt: true });
});

app.get('/api/matches', (req, res) => {
  const rows = all(`
    SELECT m.*, p.title AS property_title, p.city, p.property_type, p.asking_price, d.buyer_name
    FROM matches m
    JOIN properties p ON p.id = m.property_id
    JOIN buyer_demands d ON d.id = m.buyer_demand_id
    ORDER BY m.match_score DESC
  `);
  jsonResponse(res, { matches: rows });
});

app.get('/api/reports/property/:id.pdf', (req, res) => {
  const detail = buildPropertyContext(req.params.id);
  if (!detail) return res.status(404).send('Immobile non trovato');
  const matches = all(`
    SELECT m.*, d.buyer_name
    FROM matches m
    JOIN buyer_demands d ON d.id = m.buyer_demand_id
    WHERE m.property_id = ?
    ORDER BY m.match_score DESC
  `, [req.params.id]);
  const tasks = all('SELECT * FROM outreach_tasks WHERE property_id = ? ORDER BY created_at DESC', [req.params.id]);
  const notes = all('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', ['property', req.params.id]);
  const lines = buildReportLines(detail.property, matches, tasks, notes);
  const pdf = createSimplePdf(lines, `Report: ${detail.property.title}`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="immobile-${req.params.id}.pdf"`);
  res.send(pdf);
});

app.get('/api/export/properties.csv', (req, res) => {
  const { verdict, city } = req.query;
  const clauses = [];
  const params = [];
  if (verdict) {
    clauses.push('verdict = ?');
    params.push(verdict);
  }
  if (city) {
    clauses.push('city = ?');
    params.push(city);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = all(`
    SELECT id, title, address, city, zone, property_type, asking_price, surface_mq, price_per_mq,
           market_price_per_mq, property_score, vacancy_score, seller_motivation_score, verdict,
           criticalities, recommended_action, source_reference
    FROM properties
    ${where}
    ORDER BY updated_at DESC
  `, params);
  const csv = rowsToCsv([
    [
      'id',
      'title',
      'address',
      'city',
      'zone',
      'property_type',
      'asking_price',
      'surface_mq',
      'price_per_mq',
      'market_price_per_mq',
      'property_score',
      'vacancy_score',
      'seller_motivation_score',
      'verdict',
      'criticalities',
      'recommended_action',
      'source_reference'
    ],
    ...rows.map((row) => ([
      row.id,
      row.title,
      row.address,
      row.city,
      row.zone,
      row.property_type,
      row.asking_price,
      row.surface_mq,
      row.price_per_mq,
      row.market_price_per_mq,
      row.property_score,
      row.vacancy_score,
      row.seller_motivation_score,
      row.verdict,
      row.criticalities,
      row.recommended_action,
      row.source_reference
    ]))
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="properties-export.csv"');
  res.send(csv);
});

app.post('/api/analyze/property/:id', (req, res) => {
  const context = ensurePropertyDetail(req.params.id);
  if (!context) return res.status(404).json({ ok: false, error: 'Immobile non trovato' });

  const property = context.property;
  const matches = context.matches;
  const strongest = matches[0];
  const draftMessage = strongest
    ? `Buongiorno ${strongest.buyer_name || ''}, abbiamo un immobile in ${property.city} che potrebbe interessarle. ` +
      `Prima di procedere richiediamo approvazione umana e verifica dati.`
    : `Preparare contatto per ${property.title} dopo verifica manuale.`;

  const task = run(`
    INSERT INTO outreach_tasks (
      entity_id, property_id, buyer_demand_id, channel, task_type, status, next_action, draft_message,
      approval_status, notes, source_type, source_reference, source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    null,
    property.id,
    strongest ? strongest.buyer_demand_id : null,
    'da scegliere',
    'follow_up',
    'draft',
    'Verificare manualmente e approvare bozza',
    draftMessage,
    'pending',
    'Nessun invio automatico',
    'derived',
    'generated',
    null,
    now(),
    now()
  ]);

  jsonResponse(res, { task_id: task.lastInsertRowid, draft_message: draftMessage });
});

app.use((req, res) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.status(404).json({ ok: false, error: 'Not found' });
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`latina-property-ai running on http://localhost:${port}`);
});

server.on('error', (error) => {
  console.error('Server error:', error);
});

if (require.main === module) {
  setInterval(() => {}, 60 * 60 * 1000);
}
