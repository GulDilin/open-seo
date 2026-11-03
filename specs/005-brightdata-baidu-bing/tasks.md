---
description: "Task list for Bright Data Baidu/Bing provider"
---

# Tasks: Baidu and Bing via Bright Data

**Input**: Design documents from `/specs/005-brightdata-baidu-bing/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable; **[Story]**: US1 Baidu, US2 Bing

---

## Phase 1: Setup

- [x] T001 AT INTEGRATION: record live fixtures (baidu organic, bing organic — market-specific geo params) in src/server/lib/seo-providers/brightdata/fixtures/; pin exact engine/geo parameter names and per-engine organic maxima

## Phase 2: Foundational

- [x] T002 Create src/server/lib/seo-providers/brightdata/client.ts: SERP API call with engine param (baidu|bing), geo country/language params, bearer token auth; Zod-validated organic[]; error table per contract; providerId "brightdata"
- [x] T003 Create src/server/lib/seo-providers/brightdata/adapter.ts: single SerpProvider serving both engines (engine asserted pre-network; host-match rule; depth clamps per engine — Baidu default 50, Bing 100, from T001 findings)
- [x] T004 Adapter tests from fixtures: baidu rank, bing rank, subdomain match, engine assert rejects google before network (no client call — assert via mock absence)

## Phase 3: User Story 1 — Baidu for China (P1) 🎯 MVP

**Goal**: China trackers collect Baidu positions.
**Independent Test**: quickstart.md Scenarios A, D, E.

- [x] T005 [US1] Register brightdata for baidu in src/server/lib/seo-providers/routing.ts; workflow yandex-style live path for baidu (manual + scheduled — live-only unless T001 shows a deferred option)
- [x] T006 [US1] Scheduler budget units for baidu checks in src/server/features/rank-tracking/services/scheduledRankChecks.ts
- [x] T007 [US1] Workflow test: baidu engine routes to brightdata; token absent → failure names BRIGHTDATA_API_TOKEN; per-check isolation

## Phase 4: User Story 2 — Bing (P2)

**Goal**: Bing positions for declared markets; never mixed with Google.
**Independent Test**: quickstart.md Scenarios B, C.

- [x] T008 [US2] Add bing to brightdata adapter engines + chain entry in src/shared/search-engines.ts (SERP_PROVIDER_CHAIN.bing)
- [x] T009 [US2] Workflow test: google + bing trackers on one domain/market collect independently; results tagged per engine

## Phase 5: Polish & Cross-Cutting

- [x] T010 Jurisdiction note (operator-procured account) in docs/SELF_HOSTING_*.md alongside the env var
- [ ] T011 Run quickstart.md scenarios A–E (incl. 10-keyword Baidu parity ≥80% within ±1)
- [x] T012 [P] Update docs/maintainers/provider-migration/provider-replacement-tasks.md checkbox T4.1

---

## Dependencies & Execution Order

- T001→T002→T003→T004; US2 shares the adapter (only chain/test work)
- MVP = Phase 2 + US1

## Notes

- Chinese keywords pass through as-is; no transliteration
- Sogou/360: unsupported, documented limitation

---

## Execution notes (2026-10-22)

- API facts pinned from the official docs (fetched live): POST api.brightdata.com/request, Bearer token + body {zone, url, format:json, data_format:parsed_light} — the engine is selected by the TARGET URL (baidu.com/s?wd=, bing.com/search with mkt/cc geo), not a search_engine field; parsed organic uses `global_rank` (not position). ponytail: sync single-shot /request only — the async serp/req+response_id poller adds machinery for the same data.
- One adapter serves both engines (engine selects the URL). Workflow dispatch de-hardcoded: routing.ts now exports serpProviderById(id) — providerId→adapter map; the incumbent maps to null (its metered-client path).
- New env: BRIGHTDATA_SERP_ZONE (optional, default "serp") — AT INTEGRATION: confirm the zone name with a live token; re-record fixtures (current tests pin the mapping contract from the documented parsed schema).
- Fixture tests: subdomain match (baidu), same-adapter bing, engine assert BEFORE network, absent-domain null. Workflow test: baidu routes to the brightdata adapter with no DataForSEO fallback.
- Scheduler units already provider-neutral (keywords x devices) — T006 needed no change.
- T011 quickstart parity scenarios: live-run only (operator env with a Bright Data token).
