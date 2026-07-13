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
    ['Weather', 'weather_provider', 'Weather provider', 'Open-Meteo', 0, 'Provider meteo di default'],
    ['Weather', 'weather_api_key', 'Weather API key', '', 1, 'Chiave opzionale per provider meteo'],
    ['Weather', 'weather_base_url', 'Weather base URL', '', 0, 'Endpoint del servizio meteo'],
    ['Weather', 'weather_default_city', 'Weather default city', 'Latina', 0, 'Città per previsioni e condizioni'],
    ['Weather', 'weather_notes', 'Weather notes', '', 0, 'Uso previsto e verifiche'],
    ['General', 'crm_webhook_url', 'CRM webhook URL', '', 0, 'Facoltativo per future automazioni approvate'],
    ['General', 'crm_default_channel', 'Default CRM channel', 'whatsapp', 0, 'Canale predefinito per task'],
    ['General', 'office_email', 'Office email', '', 0, 'Casella operativa locale']
  ].forEach((item) => {
    settings.run(item[0], item[1], item[2], item[3], item[4], item[5], 'seed', 'demo-seed', now(), now());
  });
}

function cleanupDemoData() {
  const demoWhere = `record_type = 'seed' OR source_name = 'demo-seed' OR source_identifier = 'initial-demo'`;

  run(`DELETE FROM property_entity_links WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM listings WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM matches WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM outreach_tasks WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM notes WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM property_events WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM buyer_demands WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM entities WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM properties WHERE source_type = 'seed' OR source_reference = 'demo-seed'`);
  run(`DELETE FROM raw_records WHERE ${demoWhere}`);
}

function resetDemoData() {
  cleanupDemoData();
}

function initDb() {
  execSchema();
  seedDefaultSettings();
  cleanupDemoData();
}

module.exports = {
  db,
  run,
  all,
  get,
  initDb,
  resetDemoData,
  now,
  dbPath
};
