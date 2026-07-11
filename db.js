const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'latina-property-ai.sqlite');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

ensureDataDir();

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function run(sql, params = []) {
  return Array.isArray(params) ? db.prepare(sql).run(...params) : db.prepare(sql).run(params);
}

function all(sql, params = []) {
  return Array.isArray(params) ? db.prepare(sql).all(...params) : db.prepare(sql).all(params);
}

function get(sql, params = []) {
  return Array.isArray(params) ? db.prepare(sql).get(...params) : db.prepare(sql).get(params);
}

function execSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_identifier TEXT,
      payload_json TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      import_status TEXT NOT NULL DEFAULT 'imported',
      verification_status TEXT NOT NULL DEFAULT 'da verificare',
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      company TEXT,
      preferred_channel TEXT,
      status TEXT NOT NULL DEFAULT 'attivo',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'da verificare',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_ref TEXT,
      title TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      province TEXT NOT NULL DEFAULT 'LT',
      zone TEXT,
      property_type TEXT NOT NULL,
      asking_price REAL NOT NULL,
      surface_mq REAL NOT NULL,
      rooms INTEGER,
      bathrooms INTEGER,
      floor TEXT,
      condition_state TEXT,
      energy_class TEXT,
      status TEXT NOT NULL DEFAULT 'attivo',
      vacancy_status TEXT NOT NULL DEFAULT 'unknown',
      seller_motivation TEXT NOT NULL DEFAULT 'da verificare',
      notes_summary TEXT,
      price_per_mq REAL,
      market_price_per_mq REAL,
      property_score REAL,
      vacancy_score REAL,
      seller_motivation_score REAL,
      verdict TEXT NOT NULL DEFAULT 'FORSE',
      criticalities TEXT,
      recommended_action TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'da verificare',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      portal_name TEXT,
      listing_url TEXT,
      published_at TEXT,
      listing_status TEXT NOT NULL DEFAULT 'active',
      asking_price REAL,
      notes TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'da verificare',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS property_entity_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      entity_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'da verificare',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS buyer_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER,
      buyer_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      target_cities TEXT NOT NULL,
      budget_min REAL,
      budget_max REAL,
      surface_min REAL,
      surface_max REAL,
      rooms_min INTEGER,
      property_types TEXT,
      urgency TEXT NOT NULL DEFAULT 'media',
      financing_status TEXT NOT NULL DEFAULT 'da verificare',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'attiva',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'da verificare',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      buyer_demand_id INTEGER NOT NULL,
      match_score REAL NOT NULL,
      price_coherence_score REAL NOT NULL,
      demand_fit_score REAL NOT NULL,
      verdict TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      source_type TEXT NOT NULL DEFAULT 'derived',
      source_reference TEXT NOT NULL DEFAULT 'calculated',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (buyer_demand_id) REFERENCES buyer_demands(id) ON DELETE CASCADE,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS outreach_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER,
      property_id INTEGER,
      buyer_demand_id INTEGER,
      channel TEXT NOT NULL DEFAULT 'da scegliere',
      task_type TEXT NOT NULL DEFAULT 'follow_up',
      status TEXT NOT NULL DEFAULT 'draft',
      next_action TEXT NOT NULL,
      draft_message TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      approved_at TEXT,
      approved_by TEXT,
      due_at TEXT,
      notes TEXT,
      source_type TEXT NOT NULL DEFAULT 'derived',
      source_reference TEXT NOT NULL DEFAULT 'calculated',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
      FOREIGN KEY (buyer_demand_id) REFERENCES buyer_demands(id) ON DELETE SET NULL,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      note_text TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'da verificare',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS property_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      detail TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'da verificare',
      source_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (source_record_id) REFERENCES raw_records(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_label TEXT NOT NULL,
      value TEXT,
      is_secret INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_reference TEXT NOT NULL DEFAULT 'local-config',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_properties_city_type ON properties(city, property_type);
    CREATE INDEX IF NOT EXISTS idx_demands_cities ON buyer_demands(target_cities);
    CREATE INDEX IF NOT EXISTS idx_matches_property ON matches(property_id, buyer_demand_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_unique ON matches(property_id, buyer_demand_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON outreach_tasks(status, approval_status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_unique ON app_settings(provider, setting_key);
  `);
}

function now() {
  return new Date().toISOString();
}

function seedDefaultSettings() {
  const count = get('SELECT COUNT(*) AS count FROM app_settings').count;
  if (count > 0) return;

  const settings = db.prepare(`
    INSERT INTO app_settings (
      provider, setting_key, setting_label, value, is_secret, notes, source_type, source_reference, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  [
    ['OpenAI', 'openai_api_key', 'OpenAI API key', '', 1, 'Chiave per analisi testuale opzionale'],
    ['OpenAI', 'openai_model', 'OpenAI model', 'gpt-4.1-mini', 0, 'Modello suggerito per il MVP locale'],
    ['OpenAI', 'openai_base_url', 'OpenAI base URL', '', 0, 'Lascia vuoto per l endpoint standard'],
    ['Google Maps', 'google_maps_api_key', 'Google Maps API key', '', 1, 'Geocoding e mappe'],
    ['Google Maps', 'google_geocoding_api_key', 'Google Geocoding API key', '', 1, 'Riserva o chiave dedicata'],
    ['Google Maps', 'google_places_api_key', 'Google Places API key', '', 1, 'Ricerca luoghi e POI'],
    ['General', 'crm_webhook_url', 'CRM webhook URL', '', 0, 'Facoltativo per future automazioni approvate'],
    ['General', 'crm_default_channel', 'Default CRM channel', 'whatsapp', 0, 'Canale predefinito per task'],
    ['General', 'office_email', 'Office email', '', 0, 'Casella operativa locale']
  ].forEach((item) => {
    settings.run(item[0], item[1], item[2], item[3], item[4], item[5], 'seed', 'demo-seed', now(), now());
  });
}

function seedIfEmpty() {
  seedDefaultSettings();

  const count = get('SELECT COUNT(*) AS count FROM properties').count;
  if (count > 0) return;

  const seedRecord = run(
    `INSERT INTO raw_records (record_type, source_name, source_identifier, payload_json, imported_at, import_status, verification_status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'seed',
      'demo-seed',
      'initial-demo',
      JSON.stringify({ kind: 'seed', area: 'Latina e provincia' }),
      now(),
      'seeded',
      'da verificare',
      'Dati di esempio iniziali'
    ]
  );

  const rawId = seedRecord.lastInsertRowid;

  const citySet = [
    {
      title: 'Appartamento trilocale in centro',
      city: 'Latina',
      zone: 'Centro',
      property_type: 'appartamento',
      asking_price: 175000,
      surface_mq: 82,
      rooms: 3,
      bathrooms: 1,
      condition_state: 'buono',
      energy_class: 'F',
      vacancy_status: 'occupied',
      seller_motivation: 'media',
      notes_summary: 'Soluzione centrale con balcone e box',
    },
    {
      title: 'Villa con giardino',
      city: 'Sabaudia',
      zone: 'Lungomare',
      property_type: 'villa',
      asking_price: 420000,
      surface_mq: 145,
      rooms: 5,
      bathrooms: 2,
      condition_state: 'ottimo',
      energy_class: 'D',
      vacancy_status: 'vacant',
      seller_motivation: 'alta',
      notes_summary: 'Proprietario motivato, libera da subito',
    },
    {
      title: 'Bilocale da ristrutturare',
      city: 'Terracina',
      zone: 'Semicentro',
      property_type: 'appartamento',
      asking_price: 132000,
      surface_mq: 58,
      rooms: 2,
      bathrooms: 1,
      condition_state: 'da ristrutturare',
      energy_class: 'G',
      vacancy_status: 'vacant',
      seller_motivation: 'alta',
      notes_summary: 'Prezzo trattabile, richieste in arrivo',
    }
  ];

  const insertProperty = db.prepare(`
    INSERT INTO properties (
      external_ref, title, address, city, province, zone, property_type, asking_price, surface_mq,
      rooms, bathrooms, floor, condition_state, energy_class, status, vacancy_status, seller_motivation,
      notes_summary, price_per_mq, market_price_per_mq, property_score, vacancy_score, seller_motivation_score,
      verdict, criticalities, recommended_action, source_type, source_reference, source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDemand = db.prepare(`
    INSERT INTO buyer_demands (
      entity_id, buyer_name, phone, email, target_cities, budget_min, budget_max, surface_min, surface_max,
      rooms_min, property_types, urgency, financing_status, notes, status, source_type, source_reference,
      source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const entities = db.prepare(`
    INSERT INTO entities (
      entity_type, name, phone, email, company, preferred_channel, status, source_type, source_reference,
      source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoSeller = entities.run(
    'seller',
    'Famiglia Rossi',
    '3330000001',
    'rossi@example.com',
    null,
    'telefono',
    'attivo',
    'seed',
    'demo-seed',
    rawId,
    now(),
    now()
  ).lastInsertRowid;

  const demoBuyer = entities.run(
    'buyer',
    'Marco Bianchi',
    '3330000002',
    'bianchi@example.com',
    null,
    'whatsapp',
    'attivo',
    'seed',
    'demo-seed',
    rawId,
    now(),
    now()
  ).lastInsertRowid;

  citySet.forEach((item, index) => {
    const p = insertProperty.run(
      `seed-${index + 1}`,
      item.title,
      `${item.city}, ${item.zone}`,
      item.city,
      'LT',
      item.zone,
      item.property_type,
      item.asking_price,
      item.surface_mq,
      item.rooms,
      item.bathrooms,
      '2',
      item.condition_state,
      item.energy_class,
      'attivo',
      item.vacancy_status,
      item.seller_motivation,
      item.notes_summary,
      null,
      null,
      null,
      null,
      null,
      'FORSE',
      'Dati di esempio',
      'Serve verifica manuale',
      'seed',
      'demo-seed',
      rawId,
      now(),
      now()
    );

    db.prepare(`
      INSERT INTO property_entity_links (
        property_id, entity_id, role, source_type, source_reference, source_record_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.lastInsertRowid, demoSeller, 'owner', 'seed', 'demo-seed', rawId, now(), now());
  });

  insertDemand.run(
    demoBuyer,
    'Marco Bianchi',
    '3330000002',
    'bianchi@example.com',
    JSON.stringify(['Latina', 'Sabaudia', 'Terracina']),
    120000,
    220000,
    60,
    95,
    3,
    JSON.stringify(['appartamento']),
    'alta',
    'pre-approvato',
    'Cerca trilocale in zona servita',
    'attiva',
    'seed',
    'demo-seed',
    rawId,
    now(),
    now()
  );
}

function initDb() {
  execSchema();
  seedIfEmpty();
}

module.exports = {
  db,
  run,
  all,
  get,
  initDb,
  now,
  dbPath
};
