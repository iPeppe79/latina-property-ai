const BASE_PRICE_PER_MQ = {
  Latina: 2100,
  Aprilia: 1900,
  Terracina: 2800,
  Gaeta: 3200,
  Formia: 2900,
  Fondi: 1800,
  Cisterna: 1700,
  Sezze: 1500,
  Priverno: 1450,
  Sabaudia: 3300,
  Pontinia: 1650,
  Cori: 1600,
  Minturno: 2300,
  'San Felice Circeo': 4200,
  Sermoneta: 2400
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    // fall through
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function conditionScore(condition) {
  const normalized = String(condition || '').toLowerCase();
  if (normalized.includes('ottim')) return 95;
  if (normalized.includes('buon')) return 80;
  if (normalized.includes('abitab')) return 70;
  if (normalized.includes('da ristruttur')) return 40;
  if (normalized.includes('da verificare')) return 50;
  return 60;
}

function energyScore(energyClass) {
  const normalized = String(energyClass || '').toUpperCase();
  if (normalized.startsWith('A')) return 95;
  if (normalized === 'B') return 90;
  if (normalized === 'C') return 82;
  if (normalized === 'D') return 75;
  if (normalized === 'E') return 68;
  if (normalized === 'F') return 58;
  if (normalized === 'G') return 48;
  return 55;
}

function typeMultiplier(propertyType) {
  const type = String(propertyType || '').toLowerCase();
  if (type.includes('villa')) return 1.25;
  if (type.includes('attico')) return 1.15;
  if (type.includes('commercial')) return 0.9;
  if (type.includes('ufficio')) return 0.85;
  if (type.includes('terreno')) return 0.6;
  if (type.includes('appart')) return 1.0;
  return 0.95;
}

function estimateMarketPricePerMq(property, comparables = []) {
  const city = property.city;
  const propertyType = property.property_type;
  const base = BASE_PRICE_PER_MQ[city] || 1800;
  const type = typeMultiplier(propertyType);

  const similar = comparables.filter((item) => {
    if (!item) return false;
    const cityMatch = String(item.city || '').toLowerCase() === String(city || '').toLowerCase();
    const typeMatch = String(item.property_type || '').toLowerCase() === String(propertyType || '').toLowerCase();
    const surface = Number(item.surface_mq || 0);
    const targetSurface = Number(property.surface_mq || 0);
    const surfaceOk = targetSurface > 0 && surface > 0 ? Math.abs(surface - targetSurface) / targetSurface <= 0.35 : true;
    return cityMatch && typeMatch && surfaceOk && Number(item.asking_price || 0) > 0;
  });

  if (similar.length) {
    const avg = similar.reduce((sum, item) => sum + Number(item.asking_price || 0) / Math.max(1, Number(item.surface_mq || 1)), 0) / similar.length;
    return Math.round(avg);
  }

  return Math.round(base * type);
}

function scoreVacancy(property, listings = [], events = [], notes = []) {
  const status = String(property.vacancy_status || '').toLowerCase();
  let score = 35;

  if (status === 'vacant') score += 35;
  if (status === 'occupied') score -= 8;
  if (status === 'unknown') score += 5;

  const activeListings = listings.filter((item) => String(item.listing_status || '').toLowerCase() === 'active').length;
  score += clamp(activeListings * 6, 0, 18);

  const eventPenalty = events.filter((item) => /sfratto|disdetta|ritardo|scadenza/i.test(item.detail || '')).length;
  score += clamp(eventPenalty * 5, 0, 15);

  const noteHints = notes.filter((item) => /vuota|disabitata|libera|vacante/i.test(item.note_text || '')).length;
  score += clamp(noteHints * 4, 0, 12);

  return clamp(Math.round(score), 0, 100);
}

function scoreSellerMotivation(property, events = [], notes = []) {
  const status = String(property.seller_motivation || '').toLowerCase();
  let score = 30;

  if (status === 'alta') score += 40;
  if (status === 'media') score += 20;
  if (status === 'bassa') score += 5;
  if (status === 'da verificare') score += 8;

  const reductions = events.filter((item) => /ribasso|riduzione prezzo|prezzo ribassato/i.test(item.detail || '')).length;
  score += clamp(reductions * 12, 0, 24);

  const urgencyNotes = notes.filter((item) => /veloce|urgente|entro|disponibile subito|motivato/i.test(item.note_text || '')).length;
  score += clamp(urgencyNotes * 8, 0, 18);

  if (String(property.vacancy_status || '').toLowerCase() === 'vacant') {
    score += 8;
  }

  return clamp(Math.round(score), 0, 100);
}

function scoreProperty(property, marketPricePerMq, vacancyScore, sellerMotivationScore) {
  const pricePerMq = Number(property.price_per_mq || 0);
  const condition = conditionScore(property.condition_state);
  const energy = energyScore(property.energy_class);
  const priceCoherence = marketPricePerMq > 0 && pricePerMq > 0
    ? clamp(100 - Math.abs(pricePerMq - marketPricePerMq) / marketPricePerMq * 120, 0, 100)
    : 50;
  const vacancy = Number(vacancyScore || 0);
  const motivation = Number(sellerMotivationScore || 0);
  const completeness = [
    property.title,
    property.address,
    property.city,
    property.property_type,
    property.asking_price,
    property.surface_mq
  ].filter(Boolean).length / 6;

  const score = (
    priceCoherence * 0.35 +
    condition * 0.2 +
    energy * 0.1 +
    vacancy * 0.15 +
    motivation * 0.1 +
    completeness * 100 * 0.1
  );

  return clamp(Math.round(score), 0, 100);
}

function scoreDemandMatch(property, demand, marketPricePerMq) {
  const asking = Number(property.asking_price || 0);
  const surface = Number(property.surface_mq || 0);
  const budgetMin = Number(demand.budget_min || 0);
  const budgetMax = Number(demand.budget_max || 0);
  const demandSurfaceMin = Number(demand.surface_min || 0);
  const demandSurfaceMax = Number(demand.surface_max || 0);
  const roomsMin = Number(demand.rooms_min || 0);
  const propertyRooms = Number(property.rooms || 0);

  const cities = toList(demand.target_cities).map((item) => item.toLowerCase());
  const propertyTypes = toList(demand.property_types).map((item) => item.toLowerCase());

  let locationScore = 25;
  if (cities.length === 0) {
    locationScore = 12;
  } else if (cities.includes(String(property.city || '').toLowerCase())) {
    locationScore = 100;
  } else if (cities.some((city) => String(property.zone || '').toLowerCase().includes(city))) {
    locationScore = 75;
  }

  let budgetScore = 45;
  if (budgetMax > 0 && asking > 0) {
    if (asking <= budgetMax && asking >= (budgetMin || budgetMax * 0.8)) {
      budgetScore = 100;
    } else if (asking <= budgetMax * 1.08) {
      budgetScore = 72;
    } else if (asking <= budgetMax * 1.2) {
      budgetScore = 48;
    } else {
      budgetScore = 10;
    }
  }

  let surfaceScore = 50;
  if (surface > 0 && (demandSurfaceMin > 0 || demandSurfaceMax > 0)) {
    const min = demandSurfaceMin || demandSurfaceMax * 0.7;
    const max = demandSurfaceMax || demandSurfaceMin * 1.4;
    if (surface >= min && surface <= max) {
      surfaceScore = 100;
    } else if (surface >= min * 0.85 && surface <= max * 1.15) {
      surfaceScore = 72;
    } else {
      surfaceScore = 26;
    }
  }

  let roomsScore = 60;
  if (roomsMin > 0 && propertyRooms > 0) {
    roomsScore = propertyRooms >= roomsMin ? 100 : clamp(70 - (roomsMin - propertyRooms) * 20, 0, 70);
  }

  let typeScore = 60;
  if (propertyTypes.length) {
    const propertyType = String(property.property_type || '').toLowerCase();
    typeScore = propertyTypes.some((type) => propertyType.includes(type)) ? 100 : 20;
  }

  const pricePerMq = Number(property.price_per_mq || 0);
  const coherence = marketPricePerMq > 0 && pricePerMq > 0
    ? clamp(100 - Math.abs(pricePerMq - marketPricePerMq) / marketPricePerMq * 100, 0, 100)
    : 50;

  const urgency = String(demand.urgency || '').toLowerCase();
  const urgencyBoost = urgency === 'alta' ? 8 : urgency === 'bassa' ? -4 : 0;

  const score = locationScore * 0.28 + budgetScore * 0.27 + surfaceScore * 0.16 + roomsScore * 0.1 + typeScore * 0.14 + coherence * 0.05 + urgencyBoost;
  return {
    matchScore: clamp(Math.round(score), 0, 100),
    priceCoherenceScore: clamp(Math.round(coherence), 0, 100),
    demandFitScore: clamp(Math.round((locationScore + budgetScore + surfaceScore + roomsScore + typeScore) / 5), 0, 100),
    breakdown: {
      locationScore,
      budgetScore,
      surfaceScore,
      roomsScore,
      typeScore,
      coherence
    }
  };
}

function verdictForProperty({ matchScore, priceCoherenceScore, propertyScore, demandStrength }) {
  if (priceCoherenceScore < 35 || matchScore < 35 || demandStrength < 35) {
    return 'NO';
  }
  if (matchScore >= 75 && priceCoherenceScore >= 70 && propertyScore >= 55) {
    return 'SÌ';
  }
  return 'FORSE';
}

function deriveCriticalities(property, demandMatches = []) {
  const issues = [];
  const asking = Number(property.asking_price || 0);
  const market = Number(property.market_price_per_mq || 0) * Math.max(1, Number(property.surface_mq || 0));

  if (!property.address || property.source_reference === 'da verificare') issues.push('indirizzo da verificare');
  if (!property.energy_class || property.energy_class === 'da verificare') issues.push('classe energetica da verificare');
  if (market > 0 && asking > market * 1.2) issues.push('prezzo sopra mercato');
  if (demandMatches.length === 0) issues.push('nessuna domanda collegata');

  return issues;
}

function recommendedAction(verdict, criticalities, sellerMotivationScore) {
  if (verdict === 'SÌ') {
    return 'Preparare bozza di contatto e task di follow-up con approvazione umana';
  }
  if (criticalities.includes('prezzo sopra mercato')) {
    return 'Rivedere il prezzo e verificare comparabili prima del contatto';
  }
  if (sellerMotivationScore >= 70) {
    return 'Creare task CRM per contatto mirato e richiesta di conferma dati';
  }
  return 'Verificare dati mancanti e monitorare la domanda prima di agire';
}

module.exports = {
  BASE_PRICE_PER_MQ,
  toList,
  estimateMarketPricePerMq,
  scoreVacancy,
  scoreSellerMotivation,
  scoreProperty,
  scoreDemandMatch,
  verdictForProperty,
  deriveCriticalities,
  recommendedAction,
  clamp
};
