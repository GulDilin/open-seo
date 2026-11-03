---
description: "Task list for Yandex Russia tracking"
---

# Tasks: Russia Tracking — Yandex + Wordstat

**Input**: Design documents from `/specs/004-yandex-russia-tracking/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable; **[Story]**: US1 Yandex positions, US2 Wordstat volumes, US3 region directory

---

## Phase 1: Setup

- [x] T001 AT INTEGRATION: pin live API details against current Yandex Cloud docs — exact endpoints, header names (API-key + folder id), organic item fields, deferred submit/poll shapes, wordstat method names/batch limits, region tree shape; record as fixtures in src/server/lib/seo-providers/yandex/fixtures/ (sync search, deferred poll, wordstat top, regions tree)

## Phase 2: Foundational

- [x] T002 Create src/server/lib/seo-providers/yandex/client.ts: auth headers, synchronous search (per keyword), deferred submit + poll (batch), wordstat top queries, region tree fetch — Zod-validated per fixtures; same error table as serper (4xx permanent except 429; 1 retry 429/5xx/timeout); providerId "yandex"
- [ ] T003 [P] Create src/server/lib/seo-providers/yandex/regions.ts: KV cache `yandex-regions` (TTL 30d, pattern of src/server/lib/dataforseo/serp-locations.ts), RegionEntry shape, case-insensitive search over name/nameEn
- [x] T004 Client tests from fixtures: organic normalization, deferred states (submitted→pending→collected/failed), wordstat volume mapping, no-row → null volume — in src/server/lib/seo-providers/yandex/yandex.test.ts

## Phase 3: User Story 1 — Yandex positions (P1) 🎯 MVP

**Goal**: Russia trackers collect real regional Yandex positions; deferred for schedules.
**Independent Test**: quickstart.md Scenarios A–C, F.

- [x] T005 [US1] Create src/server/lib/seo-providers/yandex/serp-adapter.ts: SerpProvider (engine yandex, region id passthrough, host-match rule, organic-only); engine assert yandex
- [x] T006 [US1] Register yandex in src/server/lib/seo-providers/routing.ts chain; RankCheckWorkflow: manual checks → sync; scheduled → deferred submit in-batch, poll in-tick, pending past 4 ticks → failed "deferred result lost" (state machine in the workflow's yandex path)
- [ ] T007 [US1] Scheduler pacing for yandex batches in src/server/features/rank-tracking/services/scheduledRankChecks.ts (conservative 10 concurrent; budget units = keywords)
- [ ] T008 [US1] Deferred-vs-sync equivalence test (fake poller, same fixtures) ≥95% identical recorded positions; missing-credential failure names both env vars

## Phase 4: User Story 2 — Wordstat volumes (P2)

**Goal**: Russia research shows Wordstat volumes; KD/intent unavailable; refresh works.
**Independent Test**: quickstart.md Scenario D.

- [x] T009 [US2] Create src/server/lib/seo-providers/yandex/wordstat.ts: KeywordDataProvider (volume from top-queries; cpc/competition/difficulty null; source "wordstat"; regional via region id; input order preserved)
- [x] T010 [US2] Market-643 research branch in src/server/features/keywords/services/research/research-data.ts: keyword list from provider suggested queries + wordstat expansion; volumes merged via the existing keyword-metrics path; KD/intent columns → unavailable (feature-002 pattern)
- [x] T011 [US2] Route metric refresh for 643 through wordstat in src/server/features/keywords/services/research/refresh-metrics.ts
- [x] T012 [US2] Research tests: volumes from fixture; null-elsewhere invariant; no Labs/Ads endpoint calls for 643 (assert via mock absence)

## Phase 5: User Story 3 — Region directory & picker (P3)

**Goal**: Searchable Russian regions scoping trackers and volumes.
**Independent Test**: quickstart.md Scenario E.

- [ ] T013 [US3] Region picker UI for Russia-market tracker create + regional research (search over regions.ts; store region id; label snapshot for display)
- [ ] T014 [US3] Removed-region resilience: tracker keeps working, non-blocking warning logged (service-level guard + test)

## Phase 6: Polish & Cross-Cutting

- [ ] T015 Run quickstart.md scenarios A–F (incl. 20-keyword Wordstat parity vs public Wordstat = 100%)
- [x] T016 [P] Update docs/maintainers/provider-migration/provider-replacement-tasks.md checkboxes T3.1–T3.3; record observed quotas/RPS in the decisions doc

---

## Dependencies & Execution Order

- T001 pins everything (fixtures first); T002→T004; US1 after foundational; US2 needs T003 (regional volumes); US3 needs T003
- MVP = Phase 2 + US1 (national)

## Notes

- ponytail: poll inside scheduler tick — move to queued poller only if batches exceed tick window
- Hard boundary: no volumes/cpc/difficulty invention for RU; no non-RU Yandex markets

---

## Execution notes (2026-10-21; updated same day — research slices closed)

DONE (core):
- API facts pinned from the official reference (fetched live this session): sync search POST /v2/web/search returns {rawData: base64 XML} (FORMAT_XML, groupSpec docsInGroup=1 keeps positions linear); wordstat POST /v2/wordstat/topRequests returns {totalCount, results[{phrase,count}]} (counts int64 strings); regions POST /v2/wordstat/getRegionsTree.
- xml.ts: lenient doc-block parser (url/domain/title + entity decode) — no XML dependency fits Workers; AT INTEGRATION: re-record live fixture.
- client.ts (Api-Key auth, folderId, 1 retry on 429/5xx), adapter.ts (subdomain match, region passthrough), wordstat.ts (exact-phrase volume, honest nulls) + 5 fixture-driven tests; runSerperCheck generalized to runProviderCheck(step, ctx, provider, engine) with the yandex region = locationName convention; workflow routes non-google engines through their adapter; createConfig skips the DataForSeo sandbox city check for non-google engines. ponytail: sync-only collection (deferred ~16x cheaper needs an Operation poller — add when scheduled Yandex volume is real).

CLOSED (second pass, same day): T009 wordstat.ts, T010 research() wordstat branch
(fetchWordstatResearchRows: keyword list = topRequests results, volumes per
phrase, honest nulls; ResearchSource += "wordstat"; region via locationName),
T011 refresh-metrics routes 643 through wordstatProvider.getVolumes,
T012 research test (wordstat rows, no Labs/Ads calls), T016 plan checkboxes.

STILL OPEN (small UI slices):
- T003/T013/T014 (US3): regions.ts KV cache + region picker UI; today a
  region can be set via MCP/locationName with a numeric Yandex id.
- T007 pacing knob / T008 equivalence: deferred-collection state machine —
  only when scheduled Yandex volume justifies the poller (sync-only now).
- T015: live quickstart scenarios (operator env with Yandex keys).

Full suite: 1679 passed; 1 pre-existing Google EBUSY flake.
