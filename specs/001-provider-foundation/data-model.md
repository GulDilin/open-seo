# Data Model: Provider Foundation

No database entities in this feature. The model is in-memory configuration
and shared type definitions.

## Entities

### SearchEngine

- Union: `"google" | "yandex" | "baidu" | "bing"`.
- Zod schema `searchEngineSchema` (enum) — the single validation point for
  engine names at every trust boundary (forms, MCP args, internal calls).

### Engine availability (per market)

- Map: market key (numeric code from `keyword-locations.ts`) → engines
  offered. Default for unlisted markets: `["google"]`.
- Initial entries reflect existing markets only: every existing market →
  `["google"]`; Russia (643) and China (156) entries land in feature 002.
- Read via `isEngineAvailableForCountry(code, engine)`.
- Validation: keys must exist in `LOCATION_OPTIONS`; engines must be in the
  `SearchEngine` union (enforced by types, no runtime check needed beyond
  a unit test asserting table integrity).

### Provider descriptor

- `id`: `"serper" | "yandex" | "brightdata" | "dataforseo"`.
- `engines`: engines the provider can serve.
- `isConfigured(): boolean` — derived from credential presence (R2 rules:
  absent/empty/whitespace = not configured; yandex requires key AND folder
  id).

### Provider chain

- `SERP_PROVIDER_CHAIN: Record<SearchEngine, ProviderId[]>` — fixed
  priority order per engine (research R4).
- Resolver output: a provider id, or a typed error carrying `engine` and
  the list of missing credential variable names.

## Relationships

- Market → engines (availability table).
- Engine → providers (chain).
- Provider → credentials (env presence only; no secrets in memory beyond
  the env accessor itself).

## State transitions

None — all values are derived per read; nothing persisted.
