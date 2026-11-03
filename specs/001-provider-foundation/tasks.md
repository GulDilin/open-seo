---
description: "Task list for provider foundation feature"
---

# Tasks: Provider Foundation

**Input**: Design documents from `/specs/001-provider-foundation/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no deps)
- **[Story]**: US1 = preflight visibility, US2 = shared routing skeleton

---

## Phase 1: Setup

- [x] T001 Add optional env reads `SERPER_API_KEY`, `YANDEX_SEARCH_API_KEY`, `YANDEX_FOLDER_ID`, `BRIGHTDATA_API_TOKEN` (trim; empty/whitespace = absent) to src/server/lib/runtime-env.ts
  — implemented in providers.ts instead: runtime-env is a generic accessor with
  no variable registry; provider credential names live in
  src/shared/search-engines.ts (SEO_PROVIDER_CREDENTIALS)
- [x] T002 [P] Document the four new variables in .env.example and web/.env.example
  — .env.example + deploy/.env.selfhost.example; web/.env.example intentionally
  untouched: the marketing site has no new-provider surfaces in this phase

## Phase 2: Foundational (blocks all stories)

- [x] T003 Create src/shared/search-engines.ts: `SearchEngine` union, `searchEngineSchema` (Zod enum), `searchEngineField` (default "google"), `SERP_PROVIDER_CHAIN`, `ENGINE_AVAILABILITY` (default ["google"]), `enginesForCountry`, `isEngineAvailableForCountry`, `PROVIDER_IDS`
- [x] T004 Create src/server/lib/seo-providers/types.ts: `SerpRankCheck`, `SerpRankResult`, `SerpProvider`, `KeywordVolumeQuery`, `KeywordVolumeRow`, `KeywordDataProvider` per contracts/provider-interface.md
- [x] T005 Create src/server/lib/seo-providers/providers.ts: descriptor registry (serper, yandex, brightdata, dataforseo) with `isConfigured()` from T001 env rules (yandex = key AND folder id); no HTTP
  — shipped as isProviderConfiguredSync(env, id) + getSeoProviderStatuses();
  engine lists live in shared SEO_PROVIDER_ENGINES
- [x] T006 Table-integrity tests (chain ids known; availability non-empty; unknown market defaults google; provider engines agree with chain) in src/shared/search-engines.test.ts

## Phase 3: User Story 1 — Preflight visibility (P1) 🎯 MVP

**Goal**: Operator sees configured/not-configured per provider; secrets never rendered.
**Independent Test**: quickstart.md Scenario B (all 8 set/unset/empty combos).

- [x] T007 [P] [US1] Extend src/lib/selfhost-preflight.ts with a provider-status section (one boolean line per provider, no values) using providers.ts
  — one "SEO data providers" item whose message lists each provider's status
  (setup-status collapses items by key, so per-provider rows would overwrite
  each other); statuses + labels via the shared credential table
- [x] T008 [US1] Surface the new preflight lines in the setup-status UI path that renders preflight today (follow the existing DATAFORSEO_API_KEY row pattern)
  — no UI renders checks: Docker prints the preflight and /api/health serves
  JSON; both pick the new item up automatically via runSelfhostChecks.
  CHECK_ENV_VARS extended with the 4 new names so /api/health sees them
- [x] T009 [US1] Add a brief "Alternative SEO providers (optional)" subsection to docs/SELF_HOSTING_DOCKER.md and docs/SELF_HOSTING_CLOUDFLARE.md

## Phase 4: User Story 2 — Provider resolution skeleton (P2)

**Goal**: `resolveSerpProvider(engine)` walks the chain; errors name missing variables; no engine substitution.
**Independent Test**: quickstart.md Scenario C.

- [x] T010 [US2] Implement src/server/lib/seo-providers/routing.ts: `resolveSerpProvider(engine)` → first configured provider id, else typed error listing missing credential variable names; assert-engine ≠ own engines is an error
  — async (env read via runtime-env is async in Workers); the
  engine-belongs-to-provider assert ships with the adapters (003+), where an
  implementation exists to assert against
- [x] T011 [US2] Resolver tests in src/server/lib/seo-providers/routing.test.ts: serper-set→serper; none-set google→dataforseo; yandex missing→names both vars; no substitution path exists
  — via vi.stubEnv/unstubAllEnvs (env is the boundary here, no module mocks)

## Phase 5: Polish & Cross-Cutting

- [x] T012 Run quickstart.md scenarios A–C; confirm zero behavior change with empty env (full `pnpm test`)
  — full suite: 1662 passed; 3 Google OAuth suites flake with Windows
  EBUSY on temp-file cleanup in parallel runs, pass in isolation
  (pre-existing, unrelated to this feature). Scenario A's "no new env" case is
  covered by the unchanged-suite run; B/C credential combos are covered by the
  new unit tests (live preflight spot-checks remain for the dev environment)
- [x] T013 [P] Update docs/maintainers/provider-migration/provider-replacement-tasks.md checkboxes T0.1–T0.2

---

## Dependencies & Execution Order

- T003–T006 (Foundational) block both stories; T001 blocks T005
- US1 (T007–T009) and US2 (T010–T011) are independent of each other after Phase 2
- MVP = Phase 1 + 2 + US1

## Notes

- No HTTP anywhere in this feature; providers are presence-only until features 003+
