# Data Model: Multi-Engine Domain Model

## Changed entity: rank_tracking_configs

| Field | Type | Change |
| --- | --- | --- |
| search_engine | text NOT NULL DEFAULT 'google' | NEW; values: google \| yandex \| baidu \| bing |

### Index changes (both dialects)

- National tracker unique: (project_id, domain, location_code) →
  (project_id, domain, location_code, **search_engine**) where
  location_name IS NULL.
- Local tracker unique: (project_id, domain, location_code, location_name)
  → (+ **search_engine**) where location_name IS NOT NULL.
- Migration rebuilds both (drop + create) in one transaction with the
  column add.

### Validation rules

- `searchEngine` ∈ SearchEngine union; default "google" at Zod layer AND
  DB default (defense in depth at the trust boundary, trivial in schema).
- Engine must be available for the tracker's market (refine against
  `enginesForCountry`) — enforced in create/update schemas.
- Existing rows: migration default covers them; no backfill needed.

## Changed entity: Market registry (keyword-locations.ts)

| Market | Entry |
| --- | --- |
| Russia | `{ code: 643, label: "Russia", shortLabel: "RU", languageCode: "ru", serpEngines: ["yandex", "google"], keywordProvider: "wordstat" }` |
| China | `{ code: 156, label: "China", shortLabel: "CN", languageCode: "zh-CN", serpEngines: ["baidu"], keywordProvider: "none" }` |
| Norway | add `serpEngines: ["google", "bing"]` to existing 2057 entry |

- `LocationOption` gains optional `serpEngines?: readonly SearchEngine[]`
  (default `["google"]`) and `keywordProvider?: "labs" | "google_ads" |
  "wordstat" | "none"` (existing routing fn gains the two new returns).
- Uniqueness invariant (existing test) extended: codes 643 and 156 unique.

## State transitions

Tracker: (created google | engine set at create only) → checks run →
archive/delete. Engine is immutable after create (changing engine would
orphan history semantics); editing an engine means creating a new tracker.
This is a validation rule, not an update path.

## Relationships

- Tracker 1—1 SearchEngine (column).
- Market 1—* Tracker (existing FK by location_code, unchanged).
- Market *—* SearchEngine via availability table (feature 001).
