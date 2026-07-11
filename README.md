# latina-property-ai

MVP locale per l'analisi del mercato immobiliare di Latina e provincia.

## Avvio

```bash
npm start
```

Apri `http://localhost:3000`.

## Note operative

- Nessun invio automatico: i task CRM restano in bozza finché non vengono approvati.
- Ogni record conserva una fonte o una marcatura `da verificare`.
- Il report PDF è generato localmente senza servizi esterni.
- L'integrazione OpenAI è opzionale tramite `OPENAI_API_KEY`.
- La dashboard integrazioni salva chiavi e parametri locali in SQLite, incluse API GPT/OpenAI e Google Maps.
