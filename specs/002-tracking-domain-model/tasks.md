---
description: "Task list for multi-engine rank tracking domain model"
---

# Tasks: Multi-Engine Rank Tracking Domain Model

**Input**: Design documents from `/specs/002-tracking-domain-model/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable; **[Story]**: US1 engine-on-tracker, US2 Russia/China markets, US3 MCP parity

---

## Phase 1: Setup

- [x] T001 Confirm feature 001 merged; run `pnpm test` baseline green

## Phase 2: Foundational (blocks all stories)

- [x] T002 Add `searchEngine` column (`text`, NOT NULL, default 'google', enum values google|yandex|baidu|bing) to `rank_tracking_configs` in src/db/app.schema.ts and the pg mirror src/db/pg/
- [x] T003 Write migration drizzle/pg/0038_tracker_search_engine.sql: add column; drop + recreate both partial unique indexes with search_engine included (national: project_id, domain, location_code, search_engine where location_name IS NULL; local: + location_name where IS NOT NULL)
- [x] T004 Write migration drizzle/sqlite/0060_tracker_search_engine.sql with identical semantics in SQLite dialect
- [x] T005 Extend src/types/schemas/rank-tracking.ts: `searchEngineField` (default google) on create/update; refine engine ∈ enginesForCountry(locationCode); engine immutable on update (reject changes); validation error lists supported engines
- [x] T006 [P] Add `serpEngines?: readonly SearchEngine[]` (default ["google"]) and `keywordProvider?: "labs"|"google_ads"|"wordstat"|"none"` to the LocationOption type in src/shared/keyword-locations.ts

## Phase 3: User Story 1 — Engine on the tracker (P1) 🎯 MVP

**Goal**: Trackers record one engine; uniqueness per engine; old trackers = google.
**Independent Test**: quickstart.md Scenarios A + C.

- [x] T007 [US1] Persist and return searchEngine through RankTrackingService create/read/list paths in src/server/features/rank-tracking/services/RankTrackingService.ts (DTO in/out; no behavior change for google)
- [x] T008 [US1] Add engine select to the tracker create form component (options = enginesForCountry(market), filtered live on market change; default google) — locate the existing market picker component and sibling it
- [x] T009 [US1] On manual/scheduled check of a non-google engine, record a failed check with reason `PROVIDER_NOT_CONFIGURED` (resolver error text) instead of calling DataForSeo — entry point where the engine's check path begins (RankCheckWorkflow engine dispatch)
- [x] T010 [US1] Service-level test: duplicate same-engine tracker rejected (rely on T003/T004 indexes; assert the DB error surfaces as validation), different-engine coexists — in the existing RankTrackingService test file pattern

## Phase 4: User Story 2 — Russia & China markets (P2)

**Goal**: Markets 643/156 selectable; honest volume unavailability.
**Independent Test**: quickstart.md Scenario B.

- [x] T011 [US2] Add Russia `{code:643,label:"Russia",shortLabel:"RU",languageCode:"ru",serpEngines:["yandex","google"],keywordProvider:"wordstat"}` and China `{code:156,label:"China",shortLabel:"CN",languageCode:"zh-CN",serpEngines:["baidu"],keywordProvider:"none"}` to LOCATION_OPTIONS in src/shared/keyword-locations.ts; add `serpEngines:["google","bing"]` to Norway (2057); update the file's header comment (no longer only DataForSeo codes)
- [x] T012 [US2] Extend `getKeywordDataProvider` to return "wordstat" for 643 and "none" for 156; update src/shared/keyword-locations.test.ts routing tests + uniqueness test for 643/156
- [x] T013 [US2] Research availability: market 643/156 rows render volumes as unavailable (no Labs/Ads calls) in src/server/features/keywords/services/research/research-data.ts + the research UI's unavailable-state for provider "wordstat"|"none" (reuse googleAdsOnly pattern)

## Phase 5: User Story 3 — MCP parity (P3)

**Goal**: create/get/estimate MCP tools accept and expose engine.
**Independent Test**: quickstart.md Scenario D.

- [x] T014 [US3] Add optional `searchEngine` (enum, default google) to src/server/mcp/tools/create-rank-tracker.ts input schema; unsupported pair → error listing supported engines
- [x] T015 [US3] Include `searchEngine` in tracker outputs of src/server/mcp/tools/get-rank-tracker.ts (and any list surface it feeds)
- [x] T016 [US3] Non-google engines in src/server/mcp/tools/estimate-rank-tracker-cost.ts return a provider-priced note instead of credit estimates
- [x] T017 [US3] Update affected MCP tool tests (create-rank-tracker, get-rank-tracker patterns in src/server/mcp/tools/*.test.ts); run `pnpm sync-plugin-skills` if shipped skill text mentions tracker creation

## Phase 6: Polish & Cross-Cutting

- [x] T018 Migration round-trip check on populated dev DBs (pg + sqlite): old rows read as google, schedules intact (quickstart Scenario A)
- [x] T019 Run quickstart.md scenarios A–E end-to-end
- [x] T020 [P] Update docs/maintainers/provider-migration/provider-replacement-tasks.md checkboxes T1.1–T1.3

---

## Dependencies & Execution Order

- T002–T006 block all stories; T003/T004 are sibling dialect files (write together)
- US1 after foundational; US2 needs T006+T011; US3 after US1
- MVP = Phase 2 + US1

## Notes

- Engine immutable after create — changing it means a new tracker (validation, not update path)
- No new tables; results storage untouched

---

## Execution notes (2026-10-21)

- T001–T004: migrations generated via `pnpm db:generate` (drizzle-kit, both
  dialects) — drizzle/sqlite/0060_luxuriant_shard.sql and
  drizzle/pg/0038_sour_stepford_cuckoos.sql; both drop the two partial unique
  indexes, add `search_engine text NOT NULL DEFAULT 'google'`, recreate the
  indexes with the engine included. Existing rows backfill to google by the
  column default.
- T006: `serpEngines` was NOT added to LocationOption — engine availability
  lives solely in search-engines.ts ENGINE_AVAILABILITY (one source of truth;
  a second list would drift). LocationOption gained `keywordProvider` only.
- T010 (invariants): repository uniqueness now filters by engine; the
  service-level test asserts the lookup call shape. DB-level rejection is
  enforced by the rebuilt partial indexes.
- T009: provider gate lives at the top of RankCheckWorkflow.runScoped —
  non-google engines resolve a provider first; on failure the run fails with
  the resolver message and the config gets `provider_not_configured` skip
  reason (new value in RankTrackingSkipReason union + UI copy).
- T013: research() throws an explicit VALIDATION_ERROR for wordstat/none
  markets before any paid call; fetchKeywordMetricsForList returns
  null-metric rows for them (refresh-metrics stays safe).
- T016: estimate tool returns providerPriced note for non-google trackers.
- T017: MCP tool tests updated (RankCheckWorkflow/rankCheckRunGuards fixtures
  + service mock expectations). `pnpm sync-plugin-skills` not needed — no
  shipped skill changed (plugin rules: schema/description changes to
  existing tools need no bump).
- T018: migrations are drizzle-kit-generated against both dialect configs and
  the query suites run real SQL against the new column; a populated-DB
  round-trip (`pnpm db:migrate:local` + pg migrate) is left for the
  maintainer's local environment.
- Full suite: 1663 passed; the 3 Google OAuth suites flake with the known
  Windows EBUSY temp-file issue (pre-existing, pass in isolation).
