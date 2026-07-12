# latina-property-ai Recap

## Obiettivo

Web app locale per analizzare il mercato immobiliare di Latina e provincia, con database SQLite, backend Node.js + Express e frontend vanilla.

## Cosa include

- Dashboard immobili
- Dashboard domanda
- Scheda immobile
- Scheda richiesta cliente
- Motore di valutazione
- Motore match domanda/offerta
- CRM contatti e follow-up
- Generatore report PDF e azioni consigliate
- Export CSV immobili filtrati
- Dashboard integrazioni API per OpenAI, Google Maps, meteo e voci custom
- Ricerca online immobili con import assistito e fonte URL
- Ricerca Idealista non ufficiale via search bridge con fallback ai risultati e AI opzionale

## Regole operative

- Ogni dato deve avere una fonte o lo stato `da verificare`.
- Nessun invio automatico o spam.
- I task CRM restano in bozza finché non vengono approvati da un umano.
- Le analisi possono usare OpenAI in modo opzionale, tramite `OPENAI_API_KEY`.

## Scelte tecniche

- Runtime: Node.js
- Web server: Express
- Database: SQLite nativo `node:sqlite`
- Frontend: HTML/CSS/JavaScript vanilla
- Architettura modulare, pronta per futura migrazione a PostgreSQL

## Tabelle principali

- `properties`
- `listings`
- `entities`
- `property_entity_links`
- `buyer_demands`
- `matches`
- `outreach_tasks`
- `notes`
- `property_events`
- `raw_records`

## Funzioni principali implementate

- Inserimento manuale immobile
- Import CSV immobili
- Inserimento richiesta cliente/acquirente
- Calcolo prezzo/mq
- Calcolo `property_score`
- Calcolo `vacancy_score`
- Calcolo `seller_motivation_score`
- Calcolo `demand_match_score`
- Verdetto automatico `SÌ / FORSE / NO`
- Scheda immobile con valutazione, domanda collegata, criticità e azione consigliata
- CRM follow-up con stato, canale, prossima azione, bozza messaggio e approvazione umana
- Report PDF immobile
- Export CSV immobili filtrati
- Configurazione locale delle integrazioni API con salvataggio su SQLite

## UI recente

- Layout ibrido: software operativo con rifinitura da prodotto web moderno
- Sidebar scura e workspace chiaro per massima leggibilità
- Sezione integrazioni dedicata alle chiavi GPT/OpenAI, Google Maps, meteo e parametri custom
- Campi segreti gestibili localmente con visualizzazione on/off
- Ricerca online immobili dalla UI con bozza importabile
- Import online che prova a estrarre dati dalla pagina e usa OpenAI in modo opzionale
- Modalità Idealista non ufficiale pronta per test sulla tua zona
- Conservati i flussi esistenti per immobili, domanda, CRM, report e match

## Verifiche eseguite

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/properties/:id`
- `GET /api/reports/property/1.pdf`
- `POST /api/analyze/property/1`
- `PATCH /api/tasks/1/approve`

## Avvio

```bash
npm start
```

Aprire `http://localhost:3000`.
