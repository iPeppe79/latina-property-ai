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
- La UI include anche una ricerca online immobili con import assistito e fonte URL.
- L'import online prova a estrarre automaticamente prezzo, mq e dati utili dalla pagina; OpenAI viene usato solo se configurato.
- Idealista è integrato come fonte non ufficiale via search bridge, con fallback sui risultati se la pagina blocca il fetch diretto.
- La ricerca online supporta ranking geografico per Latina, provincia e zona mare.

## Come si usa

1. Apri `http://localhost:3000`.
2. Vai su `Ricerca immobili sul web`.
3. Scegli il motore:
   - `Web generale` per ricerca ampia
   - `Idealista non ufficiale` per testare la tua zona su Idealista
4. Scegli l'area:
   - `Latina`
   - `Provincia di Latina`
   - `Zona mare`
   - `Personalizzata`
5. Inserisci una query semplice, per esempio:
   - `appartamenti vendita`
   - `ville fronte mare`
   - `bilocali ristrutturati`
6. Premi `Cerca online`.
7. Controlla i risultati ordinati per pertinenza.
8. Premi `Analizza e importa` sul risultato che ti interessa.
9. Vai in `Dashboard immobili` per rivedere la bozza, prezzi e valutazione.
