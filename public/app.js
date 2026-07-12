const state = {
  dashboard: null,
  settings: [],
  onlineSearchResults: [],
  selectedPropertyId: null,
  selectedDemandId: null,
  showSecrets: false
};

const FIXED_SETTING_FIELDS = [
  { provider: 'OpenAI', key: 'openai_api_key', label: 'OpenAI API key', secret: true },
  { provider: 'OpenAI', key: 'openai_model', label: 'OpenAI model', secret: false },
  { provider: 'OpenAI', key: 'openai_base_url', label: 'OpenAI base URL', secret: false },
  { provider: 'OpenAI', key: 'openai_notes', label: 'OpenAI notes', secret: false },
  { provider: 'Google Maps', key: 'google_maps_api_key', label: 'Google Maps API key', secret: true },
  { provider: 'Google Maps', key: 'google_geocoding_api_key', label: 'Google Geocoding API key', secret: true },
  { provider: 'Google Maps', key: 'google_places_api_key', label: 'Google Places API key', secret: true },
  { provider: 'Google Maps', key: 'google_maps_notes', label: 'Google Maps notes', secret: false },
  { provider: 'Weather', key: 'weather_provider', label: 'Weather provider', secret: false },
  { provider: 'Weather', key: 'weather_api_key', label: 'Weather API key', secret: true },
  { provider: 'Weather', key: 'weather_base_url', label: 'Weather base URL', secret: false },
  { provider: 'Weather', key: 'weather_default_city', label: 'Weather default city', secret: false },
  { provider: 'Weather', key: 'weather_notes', label: 'Weather notes', secret: false }
];

const el = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) return response.blob();
  return response.json();
}

function money(value) {
  const number = Number(value || 0);
  return `€${number.toLocaleString('it-IT')}`;
}

function pct(value) {
  return `${Math.round(Number(value || 0))}/100`;
}

function prettyList(value) {
  if (!value) return 'da verificare';
  if (Array.isArray(value)) return value.join(', ');
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch {
    // ignore
  }
  return String(value).replaceAll('"', '');
}

function badgeForVerdict(verdict) {
  if (verdict === 'SÌ') return 'pill';
  if (verdict === 'NO') return 'pill danger';
  return 'pill warn';
}

function settingKey(provider, key) {
  return `${provider}::${key}`;
}

function normalizedSettings(settings) {
  return new Map(settings.map((item) => [settingKey(item.provider, item.setting_key), item]));
}

function renderStats(stats) {
  const grid = el('statsGrid');
  grid.innerHTML = [
    ['Immobili', stats.properties, 'record attivi'],
    ['Domande', stats.demands, 'richieste cliente'],
    ['Match', stats.matches, 'abbinamenti calcolati'],
    ['Task', stats.tasks, 'bozze CRM'],
    ['Approvals pending', stats.pendingApprovals, 'in attesa'],
    ['Fonti', stats.sources || 0, 'record verificabili']
  ].map(([label, value, hint]) => `
    <article class="stat">
      <div class="label">${label}</div>
      <div class="value">${value || 0}</div>
      <div class="hint">${hint}</div>
    </article>
  `).join('');
}

function renderPropertyList(properties) {
  const search = el('propertySearch').value.toLowerCase();
  const verdict = el('propertyVerdictFilter').value;
  const filtered = properties.filter((property) => {
    const haystack = [property.title, property.address, property.city, property.zone, property.property_type]
      .join(' ')
      .toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesVerdict = !verdict || property.verdict === verdict;
    return matchesSearch && matchesVerdict;
  });

  el('propertyList').innerHTML = filtered.map((property) => `
    <button class="list-item ${Number(state.selectedPropertyId) === Number(property.id) ? 'selected' : ''}" data-property-id="${property.id}">
      <h4>${property.title}</h4>
      <div class="meta">
        <span>${property.city}</span>
        <span>${property.property_type}</span>
        <span>${money(property.asking_price)}</span>
      </div>
      <div class="meta meta--stacked">
        <span class="${badgeForVerdict(property.verdict)}">${property.verdict}</span>
        <span>Score ${Math.round(property.property_score || 0)}</span>
        <span>Match ${Number(property.match_count || 0)}</span>
      </div>
    </button>
  `).join('') || '<div class="empty-state">Nessun immobile trovato.</div>';
}

function renderDemandList(demands) {
  el('demandList').innerHTML = demands.map((demand) => `
    <button class="list-item ${Number(state.selectedDemandId) === Number(demand.id) ? 'selected' : ''}" data-demand-id="${demand.id}">
      <h4>${demand.buyer_name}</h4>
      <div class="meta">
        <span>${prettyList(demand.target_cities)}</span>
        <span>${money(demand.budget_min)} - ${money(demand.budget_max)}</span>
      </div>
      <div class="meta meta--stacked">
        <span class="pill">Match ${Number(demand.matched_properties || 0)}</span>
        <span>${demand.urgency}</span>
      </div>
    </button>
  `).join('') || '<div class="empty-state">Nessuna richiesta cliente trovata.</div>';
}

function renderTasks(tasks) {
  const list = el('taskList');
  if (!list) return;
  if (!tasks.length) {
    list.innerHTML = '<div class="empty-state">Nessun task CRM presente.</div>';
    return;
  }
  list.innerHTML = tasks.map((task) => `
    <article class="task-item">
      <div class="task-line">
        <div>
          <h4>${task.property_title || 'Task senza immobile'}</h4>
          <div class="meta">
            <span>${task.channel}</span>
            <span>${task.status}</span>
            <span>${task.buyer_name || 'cliente non collegato'}</span>
          </div>
        </div>
        <span class="pill ${task.approval_status === 'approved' ? '' : 'warn'}">${task.approval_status}</span>
      </div>
      <p class="small">${task.next_action}</p>
      <p class="small">${task.draft_message}</p>
      <div class="hero-actions">
        <button data-approve-task="${task.id}" ${task.approval_status === 'approved' ? 'disabled' : ''}>Approva</button>
      </div>
    </article>
  `).join('');
}

function renderOnlineSearchResults(results) {
  const container = el('onlineSearchResults');
  if (!results.length) {
    container.innerHTML = '<div class="empty-state">Nessun risultato ancora. Avvia una ricerca online.</div>';
    return;
  }

  container.innerHTML = results.map((result) => `
    <article class="search-result">
      <div class="task-line">
        <div>
          <h4>${result.title}</h4>
          <div class="meta">
            <span>${result.source}</span>
            <span>${result.city || 'Latina'}</span>
            <span>${result.property_type || 'da verificare'}</span>
          </div>
        </div>
        <span class="pill warn">da verificare</span>
      </div>
      <p class="small">${result.snippet || 'Nessuna descrizione disponibile'}</p>
      <div class="search-link">
        <a href="${result.url}" target="_blank" rel="noreferrer">Apri fonte</a>
      </div>
      <div class="hero-actions">
        <button data-import-online-result="${result.id}" class="primary">Analizza e importa</button>
      </div>
    </article>
  `).join('');
}

function parseMaybeJson(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

function renderPropertyDetail(payload) {
  const { property, matches, tasks, notes, sellerLinks, computed } = payload;
  const detail = el('propertyDetail');
  if (!property) {
    detail.innerHTML = '<div class="empty-state">Scheda non disponibile.</div>';
    return;
  }
  const criticalities = parseMaybeJson(property.criticalities);
  detail.innerHTML = `
    <div class="task-line">
      <div>
        <div class="section-kicker">Scheda immobile</div>
        <h4>${property.title}</h4>
        <div class="meta">
          <span>${property.address}</span>
          <span>${property.city}</span>
          <span>${property.zone || 'zona da verificare'}</span>
        </div>
      </div>
      <div class="hero-actions">
        <button data-generate-report="${property.id}">Report PDF</button>
        <button data-analyze-property="${property.id}" class="primary">Genera task</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-box">
        <div class="label">Prezzo / mq</div>
        <strong>${money(property.price_per_mq)}</strong>
      </div>
      <div class="detail-box">
        <div class="label">Prezzo mercato stimato</div>
        <strong>${money(property.market_price_per_mq)}</strong>
      </div>
      <div class="detail-box">
        <div class="label">Property score</div>
        <strong>${pct(property.property_score)}</strong>
      </div>
      <div class="detail-box">
        <div class="label">Vacancy score</div>
        <strong>${pct(property.vacancy_score)}</strong>
      </div>
      <div class="detail-box">
        <div class="label">Seller motivation</div>
        <strong>${pct(property.seller_motivation_score)}</strong>
      </div>
      <div class="detail-box">
        <div class="label">Verdetto</div>
        <strong class="${badgeForVerdict(property.verdict)}">${property.verdict}</strong>
      </div>
    </div>

    <div class="detail-group">
      <div class="section-kicker">Domanda collegata</div>
      <div class="list list--tight">
        ${(matches || []).map((match) => `
          <article class="list-item">
            <h4>${match.buyer_name}</h4>
            <div class="meta">
              <span>Match ${Math.round(match.match_score)}</span>
              <span>Coerenza prezzo ${Math.round(match.price_coherence_score)}</span>
              <span>${match.verdict}</span>
            </div>
            <p class="small">${match.rationale}</p>
          </article>
        `).join('') || '<div class="empty-state">Nessun match attivo.</div>'}
      </div>
    </div>

    <div class="detail-group">
      <div class="section-kicker">Criticità</div>
      <ul class="compact-list">${criticalities.length ? criticalities.map((item) => `<li>${item}</li>`).join('') : '<li>Nessuna criticità principale</li>'}</ul>
    </div>

    <div class="detail-group">
      <div class="section-kicker">Azione consigliata</div>
      <p>${property.recommended_action || 'Da verificare'}</p>
    </div>

    <div class="detail-meta">
      <span>Fonti: ${property.source_reference || 'da verificare'}</span>
      <span>Links: ${sellerLinks.length}</span>
      <span>Note: ${notes.length}</span>
      <span>Task collegati: ${tasks.length}</span>
    </div>
    ${computed ? `<div class="small">Calcolo aggiornato: score ${Math.round(computed.propertyScore)}, market ${money(computed.marketPricePerMq)}</div>` : ''}
  `;
}

function renderDemandDetail(payload) {
  const { demand, matches, notes } = payload;
  const detail = el('demandDetail');
  if (!demand) {
    detail.innerHTML = '<div class="empty-state">Scheda non disponibile.</div>';
    return;
  }
  detail.innerHTML = `
    <div class="task-line">
      <div>
        <div class="section-kicker">Scheda richiesta</div>
        <h4>${demand.buyer_name}</h4>
        <div class="meta">
          <span>${prettyList(demand.target_cities)}</span>
          <span>${money(demand.budget_min)} - ${money(demand.budget_max)}</span>
        </div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-box"><div class="label">Surface</div><strong>${demand.surface_min || 'n/d'} - ${demand.surface_max || 'n/d'}</strong></div>
      <div class="detail-box"><div class="label">Rooms min</div><strong>${demand.rooms_min || 'n/d'}</strong></div>
      <div class="detail-box"><div class="label">Urgenza</div><strong>${demand.urgency}</strong></div>
      <div class="detail-box"><div class="label">Finanziamento</div><strong>${demand.financing_status}</strong></div>
    </div>

    <div class="detail-group">
      <div class="section-kicker">Match attivi</div>
      <div class="list list--tight">
        ${(matches || []).map((match) => `
          <article class="list-item">
            <h4>${match.title}</h4>
            <div class="meta">
              <span>${match.city}</span>
              <span>${money(match.asking_price)}</span>
              <span>Match ${Math.round(match.match_score)}</span>
            </div>
            <p class="small">${match.rationale || 'Da verificare'}</p>
          </article>
        `).join('') || '<div class="empty-state">Nessun match collegato.</div>'}
      </div>
    </div>

    <div class="detail-group">
      <div class="section-kicker">Note</div>
      <div class="small">${notes.length ? notes.map((note) => note.note_text).join('<br />') : 'Nessuna nota'}</div>
    </div>
  `;
}

function renderForms() {
  const propertyForm = el('propertyForm');
  const demandForm = el('demandForm');
  propertyForm.innerHTML = el('propertyFormTemplate').innerHTML;
  demandForm.innerHTML = el('demandFormTemplate').innerHTML;

  propertyForm.addEventListener('submit', onPropertySubmit);
  demandForm.addEventListener('submit', onDemandSubmit);
}

function renderSettingInputs() {
  const map = normalizedSettings(state.settings);

  FIXED_SETTING_FIELDS.forEach((spec) => {
    const field = document.querySelector(
      `[data-setting-provider="${spec.provider}"][data-setting-key="${spec.key}"]`
    );
    if (!field) return;
    const row = map.get(settingKey(spec.provider, spec.key));
    field.value = row?.value ?? '';
    field.dataset.secretField = spec.secret ? 'true' : 'false';
    if (field.tagName === 'INPUT') {
      field.type = spec.secret && !state.showSecrets ? 'password' : 'text';
    }
  });

  const usedKeys = new Set(FIXED_SETTING_FIELDS.map((item) => settingKey(item.provider, item.key)));
  const customSettings = state.settings.filter((item) => !usedKeys.has(settingKey(item.provider, item.setting_key)));
  renderCustomSettings(customSettings);
}

function createCustomRow(data = {}) {
  const template = el('customSettingRowTemplate');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = template.innerHTML.trim();
  const row = wrapper.firstElementChild;
  row.querySelectorAll('[data-custom-field]').forEach((input) => {
    const key = input.dataset.customField;
    input.value = data[key] ?? '';
    if (key === 'is_secret') {
      input.value = String(data.is_secret ? 1 : 0);
    }
  });
  row.querySelector('[data-remove-setting-row]').addEventListener('click', () => {
    row.remove();
  });
  return row;
}

function renderCustomSettings(customSettings) {
  const list = el('customSettingsList');
  list.innerHTML = '';
  if (customSettings.length) {
    customSettings.forEach((item) => {
      list.appendChild(createCustomRow({
        provider: item.provider,
        setting_key: item.setting_key,
        setting_label: item.setting_label,
        value: item.value,
        is_secret: item.is_secret ? 1 : 0,
        notes: item.notes
      }));
    });
    return;
  }
  list.appendChild(createCustomRow());
}

async function loadSettings() {
  const result = await api('/api/settings');
  state.settings = result.settings || [];
  renderSettingInputs();
}

async function saveSettings(event) {
  event.preventDefault();
  const settings = [];

  FIXED_SETTING_FIELDS.forEach((spec) => {
    const field = document.querySelector(
      `[data-setting-provider="${spec.provider}"][data-setting-key="${spec.key}"]`
    );
    if (!field) return;
    settings.push({
      provider: spec.provider,
      setting_key: spec.key,
      setting_label: spec.label,
      value: field.value,
      is_secret: spec.secret ? 1 : 0,
      notes: ''
    });
  });

  const customRows = [...document.querySelectorAll('.custom-setting-row')];
  customRows.forEach((row) => {
    const values = Object.fromEntries([...row.querySelectorAll('[data-custom-field]')].map((input) => [input.dataset.customField, input.value]));
    const hasContent = Object.values(values).some((value) => String(value || '').trim() !== '');
    if (!hasContent) return;
    if (!values.provider || !values.setting_key) return;
    settings.push({
      provider: values.provider,
      setting_key: values.setting_key,
      setting_label: values.setting_label || values.setting_key,
      value: values.value || '',
      is_secret: Number(values.is_secret || 0),
      notes: values.notes || ''
    });
  });

  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
  await loadSettings();
}

async function onPropertySubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.rooms = payload.rooms ? Number(payload.rooms) : null;
  payload.bathrooms = payload.bathrooms ? Number(payload.bathrooms) : null;
  payload.asking_price = Number(payload.asking_price);
  payload.surface_mq = Number(payload.surface_mq);
  payload.province = 'LT';
  await api('/api/properties', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  event.currentTarget.reset();
  await refreshAll();
}

async function onDemandSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  await api('/api/demands', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  event.currentTarget.reset();
  await refreshAll();
}

async function importCsv() {
  const file = el('csvFile').files[0];
  if (!file) {
    alert('Seleziona un CSV.');
    return;
  }
  const csvText = await file.text();
  await api('/api/properties/import-csv', {
    method: 'POST',
    body: JSON.stringify({
      csvText,
      source_name: el('csvSource').value || file.name
    })
  });
  await refreshAll();
}

async function renderSelectedProperty(id) {
  state.selectedPropertyId = Number(id);
  const payload = await api(`/api/properties/${id}`);
  renderPropertyDetail(payload);
  renderPropertyList(state.dashboard.properties);
}

async function renderSelectedDemand(id) {
  state.selectedDemandId = Number(id);
  const payload = await api(`/api/demands/${id}`);
  renderDemandDetail(payload);
  renderDemandList(state.dashboard.demands);
}

async function searchOnlineProperties() {
  const payload = {
    query: el('onlineSearchQuery').value,
    city: el('onlineSearchCity').value,
    property_type: el('onlineSearchType').value,
    portals: el('onlineSearchPortals').value,
    limit: Number(el('onlineSearchLimit').value || 10)
  };
  const response = await api('/api/properties/search-online', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  state.onlineSearchResults = response.results || [];
  renderOnlineSearchResults(state.onlineSearchResults);
}

async function refreshDashboard() {
  const dashboard = await api('/api/dashboard');
  state.dashboard = dashboard;
  renderStats(dashboard.stats);
  renderPropertyList(dashboard.properties);
  renderDemandList(dashboard.demands);
  renderTasks(dashboard.tasks);
  if (!state.selectedPropertyId && dashboard.properties.length) {
    state.selectedPropertyId = dashboard.properties[0].id;
  }
  if (!state.selectedDemandId && dashboard.demands.length) {
    state.selectedDemandId = dashboard.demands[0].id;
  }
}

async function refreshAll() {
  await refreshDashboard();
  await loadSettings();
  renderOnlineSearchResults(state.onlineSearchResults);
  if (state.selectedPropertyId) {
    await renderSelectedProperty(state.selectedPropertyId);
  }
  if (state.selectedDemandId) {
    await renderSelectedDemand(state.selectedDemandId);
  }
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    el('healthStatus').textContent = `Online · ${health.now}`;
  } catch (err) {
    el('healthStatus').textContent = 'Offline';
  }
}

function toggleSecretVisibility() {
  state.showSecrets = !state.showSecrets;
  const button = el('toggleSecretsBtn');
  button.textContent = state.showSecrets ? 'Nascondi segreti' : 'Mostra segreti';
  document.querySelectorAll('[data-secret-field="true"]').forEach((input) => {
    input.type = state.showSecrets ? 'text' : 'password';
  });
}

function addCustomSettingRow() {
  el('customSettingsList').appendChild(createCustomRow());
}

function bindEvents() {
  document.body.addEventListener('click', async (event) => {
    const propertyButton = event.target.closest('[data-property-id]');
    if (propertyButton) {
      await renderSelectedProperty(propertyButton.dataset.propertyId);
      return;
    }

    const demandButton = event.target.closest('[data-demand-id]');
    if (demandButton) {
      await renderSelectedDemand(demandButton.dataset.demandId);
      return;
    }

    const approveButton = event.target.closest('[data-approve-task]');
    if (approveButton) {
      await api(`/api/tasks/${approveButton.dataset.approveTask}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ approved_by: 'utente locale' })
      });
      await refreshAll();
      return;
    }

    const reportButton = event.target.closest('[data-generate-report]');
    if (reportButton) {
      window.open(`/api/reports/property/${reportButton.dataset.generateReport}.pdf`, '_blank');
      return;
    }

    const analyzeButton = event.target.closest('[data-analyze-property]');
    if (analyzeButton) {
      await api(`/api/analyze/property/${analyzeButton.dataset.analyzeProperty}`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await refreshAll();
      return;
    }

    const importOnlineButton = event.target.closest('[data-import-online-result]');
    if (importOnlineButton) {
      const payload = state.onlineSearchResults.find((item) => String(item.id) === String(importOnlineButton.dataset.importOnlineResult));
      if (!payload) return;
      await api('/api/properties/import-online-result', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await refreshAll();
      await searchOnlineProperties();
      return;
    }
  });

  el('refreshBtn').addEventListener('click', refreshAll);
  el('refreshBtnInline').addEventListener('click', refreshAll);
  el('rebuildMatchesBtn').addEventListener('click', async () => {
    await api('/api/matches/rebuild', { method: 'POST', body: JSON.stringify({}) });
    await refreshAll();
  });
  el('rebuildMatchesBtnInline').addEventListener('click', async () => {
    await api('/api/matches/rebuild', { method: 'POST', body: JSON.stringify({}) });
    await refreshAll();
  });
  el('importCsvBtn').addEventListener('click', importCsv);
  el('exportCsvBtn').addEventListener('click', () => {
    const verdict = el('propertyVerdictFilter').value;
    const q = el('propertySearch').value;
    const params = new URLSearchParams();
    if (verdict) params.set('verdict', verdict);
    if (q) params.set('q', q);
    window.location.href = `/api/export/properties.csv${params.toString() ? `?${params}` : ''}`;
  });

  el('propertySearch').addEventListener('input', () => renderPropertyList(state.dashboard?.properties || []));
  el('propertyVerdictFilter').addEventListener('change', () => renderPropertyList(state.dashboard?.properties || []));
  el('settingsForm').addEventListener('submit', saveSettings);
  el('toggleSecretsBtn').addEventListener('click', toggleSecretVisibility);
  el('addCustomSettingBtn').addEventListener('click', addCustomSettingRow);
  el('onlineSearchBtn').addEventListener('click', searchOnlineProperties);

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const target = document.getElementById(button.dataset.view);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

async function main() {
  renderForms();
  bindEvents();
  await loadHealth();
  await refreshAll();
}

main().catch((error) => {
  console.error(error);
  alert(`Errore inizializzazione: ${error.message}`);
});
