const state = {
  dashboard: null,
  selectedPropertyId: null,
  selectedDemandId: null
};

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

function renderStats(stats) {
  const grid = el('statsGrid');
  grid.innerHTML = [
    ['Immobili', stats.properties],
    ['Domande', stats.demands],
    ['Match', stats.matches],
    ['Task', stats.tasks],
    ['Approvals pending', stats.pendingApprovals]
  ].map(([label, value]) => `
    <div class="stat">
      <div class="label">${label}</div>
      <div class="value">${value || 0}</div>
    </div>
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
      <div class="meta" style="margin-top: .45rem">
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
      <div class="meta" style="margin-top: .45rem">
        <span class="pill">Match ${Number(demand.matched_properties || 0)}</span>
        <span>${demand.urgency}</span>
      </div>
    </button>
  `).join('') || '<div class="empty-state">Nessuna richiesta cliente trovata.</div>';
}

function renderTasks(tasks) {
  const list = el('taskList');
  if (!tasks.length) {
    list.innerHTML = '<div class="empty-state">Nessun task CRM presente.</div>';
    return;
  }
  list.innerHTML = tasks.map((task) => `
    <div class="task-item">
      <div class="task-line">
        <h4>${task.property_title || 'Task senza immobile'}</h4>
        <span class="pill ${task.approval_status === 'approved' ? '' : 'warn'}">${task.approval_status}</span>
      </div>
      <div class="meta">
        <span>${task.channel}</span>
        <span>${task.status}</span>
        <span>${task.buyer_name || 'cliente non collegato'}</span>
      </div>
      <p class="small">${task.next_action}</p>
      <p class="small">${task.draft_message}</p>
      <div class="hero-actions">
        <button data-approve-task="${task.id}" ${task.approval_status === 'approved' ? 'disabled' : ''}>Approva</button>
      </div>
    </div>
  `).join('');
}

function renderPropertyDetail(payload) {
  const { property, matches, tasks, notes, sellerLinks, computed } = payload;
  const detail = el('propertyDetail');
  if (!property) {
    detail.innerHTML = '<div class="empty-state">Scheda non disponibile.</div>';
    return;
  }
  const criticalities = Array.isArray(property.criticalities)
    ? property.criticalities
    : (() => {
        try {
          return property.criticalities ? JSON.parse(property.criticalities) : [];
        } catch {
          return [];
        }
      })();
  detail.innerHTML = `
    <div class="task-line">
      <div>
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

    <h4>Domanda collegata</h4>
    <div class="list" style="max-height: 260px;">
      ${(matches || []).map((match) => `
        <div class="list-item">
          <h4>${match.buyer_name}</h4>
          <div class="meta">
            <span>Match ${Math.round(match.match_score)}</span>
            <span>Coerenza prezzo ${Math.round(match.price_coherence_score)}</span>
            <span>${match.verdict}</span>
          </div>
          <p class="small">${match.rationale}</p>
        </div>
      `).join('') || '<div class="empty-state">Nessun match attivo.</div>'}
    </div>

    <h4>Criticità</h4>
    <ul>${criticalities.length ? criticalities.map((item) => `<li>${item}</li>`).join('') : '<li>Nessuna criticità principale</li>'}</ul>

    <h4>Azione consigliata</h4>
    <p>${property.recommended_action || 'Da verificare'}</p>

    <h4>Dati di supporto</h4>
    <div class="small">Fonti: ${property.source_reference || 'da verificare'} | Links: ${sellerLinks.length} | Note: ${notes.length}</div>
    ${computed ? `<div class="small">Calcolo aggiornato: score ${computed.propertyScore}, market ${money(computed.marketPricePerMq)}</div>` : ''}
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

    <h4>Match attivi</h4>
    <div class="list" style="max-height: 260px;">
      ${(matches || []).map((match) => `
        <div class="list-item">
          <h4>${match.title}</h4>
          <div class="meta">
            <span>${match.city}</span>
            <span>${money(match.asking_price)}</span>
            <span>Match ${Math.round(match.match_score)}</span>
          </div>
          <p class="small">${match.rationale}</p>
        </div>
      `).join('') || '<div class="empty-state">Nessun match collegato.</div>'}
    </div>

    <h4>Note</h4>
    <div class="small">${notes.length ? notes.map((note) => note.note_text).join('<br />') : 'Nessuna nota'}</div>
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
  });

  el('refreshBtn').addEventListener('click', refreshAll);
  el('rebuildMatchesBtn').addEventListener('click', async () => {
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

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
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
