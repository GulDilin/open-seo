# Research: Provider Foundation

All decisions below were pre-made in
`docs/maintainers/provider-migration/provider-replacement-decisions.md`
(web-verified October 2026) and are restated here in plan format. No open
NEEDS CLARIFICATION items.

## R1: Which providers get credentials in this phase

- **Decision**: Serper (Google), Yandex Search API (key + folder id),
  Bright Data (token). DataForSeo remains as-is.
- **Rationale**: matches the engine coverage the migration needs —
  Google (Serper $1/1k → $0.30/1k, 2500 free), Yandex (official API, the
  only source of true Russian regional SERP + Wordstat), Baidu/Bing
  (Bright Data, 7 engines, PAYG $1–1.5/1k).
- **Alternatives considered**: SerpApi (pricier, $5.5–25/1k), SearchApi,
  HasData (narrower coverage); Мутаген (rejected: mandatory attribution +
  resale ban in API terms); single-provider strategies (rejected: no
  provider covers Yandex + Baidu + Google).

## R2: Credential shape and reading

- **Decision**: four optional env vars — `SERPER_API_KEY`,
  `YANDEX_SEARCH_API_KEY`, `YANDEX_FOLDER_ID`, `BRIGHTDATA_API_TOKEN` —
  read via existing `runtime-env.ts` (process.env then Workers env), no
  caching, presence checked per read; whitespace-only = absent.
- **Rationale**: mirrors `DATAFORSEO_API_KEY` handling; per-read keeps
  parity with the incumbent's behavior in `core.ts`.
- **Alternatives considered**: a single JSON blob env (rejected: worse DX
  and docs), startup-time snapshot (rejected: drift from incumbent
  behavior).

## R3: Where the engine-availability table lives

- **Decision**: `src/shared/search-engines.ts` — one module both client
  pickers and server validation import.
- **Rationale**: Constitution IV — UI, server, and MCP validation must
  read one table and cannot drift. The repo already uses `src/shared` for
  exactly this pattern (`keyword-locations.ts`).
- **Alternatives considered**: server-only + endpoint for UI (rejected:
  extra round-trip and a second copy risk); generated from provider
  capabilities at runtime (rejected: availability is a product decision,
  not a provider fact).

## R4: Resolver semantics

- **Decision**: `resolveSerpProvider(engine)` walks a fixed priority chain
  (google: serper → dataforseo; yandex: yandex; baidu/bing: brightdata),
  returns first configured; none configured → error naming the missing
  credential(s); no cross-engine substitution.
- **Rationale**: deterministic, explainable in support conversations;
  no-substitution rule comes from the spec (FR-005) — a silent Google
  fallback for a Yandex request would corrupt trust in the data.
- **Alternatives considered**: round-robin/failover across engines
  (rejected: hides outages), per-project provider override (deferred: no
  user need yet).

## R5: Preflight surfacing

- **Decision**: extend the existing selfhost preflight with one line per
  provider: configured / not configured. No values.
- **Rationale**: operators already use preflight for `DATAFORSEO_API_KEY`;
  same mental model, same screen.
- **Alternatives considered**: a dedicated providers settings page
  (rejected for this phase — nothing to configure beyond env).
