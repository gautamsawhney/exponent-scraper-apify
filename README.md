# Exponent Questions Scraper (Apify Actor)

Scrapes all interview questions from https://www.tryexponent.com/questions using the Apify SDK (Crawlee) and exports to the run's dataset (download CSV/JSON from Apify).

## Files
- `main.js` — Actor logic (CheerioCrawler).  
- `package.json` — dependencies and start script.  
- `apify.json` — actor metadata, table display fields.  
- `INPUT_SCHEMA.json` — configurable input (startPage, endPage, rateLimitMs, useApifyProxy).

## Run on Apify
Upload as an Actor and run with e.g.:
```json
{
  "startPage": 1,
  "endPage": 202,
  "rateLimitMs": 800,
  "useApifyProxy": true
}
```

## Local dev
```bash
npm install
npm start
```

## Output fields
- `questionText`
- `companyNames`
- `askedWhen` (dd/mm/yyyy when available)
- `tags`
- `answerCount`
- `answersUrl`