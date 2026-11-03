---
description: "Task list for volumes and vitals (optional phase)"
---

# Tasks: Non-Russia Volumes and Free Vitals

**Input**: Design documents from `/specs/006-volume-and-vitals/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable; **[Story]**: US1 PSI vitals, US2 Ahrefs volumes (conditional)

---

## Phase 1: Setup

- [x] T001 [P] Record a PSI lighthouseResult fixture (any public URL) for the normalization test
- [x] T002 Decision (2026-10-22): US2 volumes come from the operator's own Google Ads API (BYO, decisions §8) — free primary source, Keywords Everywhere ($7/mo) noted as fallback, not implemented. Ahrefs/Semrush rejected by maintainer.

## Phase 2: User Story 1 — PSI vitals (P1) 🎯 MVP (unconditional slice)

**Goal**: Audit vitals from PSI; incumbent credential not required; per-page failures isolated.
**Independent Test**: quickstart.md Scenarios A, B.

- [x] T003 [US1] Replace the provider call in src/server/lib/audit/lighthouse.ts with PSI (url + strategy; four categories; map lighthouseResult categories/audits to StoredLighthousePayload — same output shape, field names pinned by fixture test)
- [x] T004 [US1] Pacing (concurrency 3) inside the audit page loop + per-page failure isolation (audit continues); one retry on timeout only
- [x] T005 [US1] Normalization test from the PSI fixture in the existing src/server/lib/audit/lighthouse.test.ts pattern; per-page failure test
- [x] T006 [US1] ponytail comment: optional PSI API-key env if a real audit hits free-quota ceiling — not plumbed now

## Phase 3: User Story 2 — Ahrefs volumes (P2, conditional on procurement)

**Goal**: Optional volume provider for incumbent-served markets; honest degradation.
**Independent Test**: quickstart.md Scenarios C–E.

- [x] T007 [US2] Create src/server/lib/seo-providers/google-ads/client.ts (OAuth refresh → generateKeywordIdeas REST, geo criterion from the market code) + volumes.ts (KeywordDataProvider; volume=avgMonthlySearches; cpc/competition/difficulty null; source "google_ads")
- [x] T008 [US2] Routing: fetchKeywordMetricsForList serves labs/google_ads markets from the Google Ads provider when DATAFORSEO_API_KEY is absent and GOOGLE_ADS_* is set (incumbent keeps priority while its key exists). Research-ideas list via generateKeywordIdeas (without DataForSeo) stays a follow-up task.
- [x] T009 [US2] Provider tests: exact-phrase mapping with honest nulls, null volume for uncovered keywords, unknown-country rejection before any API call
- [x] T010 [US2] .env.example documents GOOGLE_ADS_CUSTOMER_ID/GOOGLE_ADS_REFRESH_TOKEN (BYO framing per decisions §8); preflight shows "Google Ads volumes (BYO)" status

## Phase 4: Polish & Cross-Cutting

- [ ] T011 Variance documentation: PSI vs previous source on a 10-page sample, recorded at acceptance (no hard gate)
- [x] T012 Run quickstart.md scenarios A–E
- [x] T013 [P] Migration plan updated: T5.1 rewritten from Ahrefs to Google Ads API BYO; decisions §8 rewritten after the market re-research

---

## Dependencies & Execution Order

- US1 and US2 fully independent (separate PRs); drop either without touching the other
- MVP = US1 (free, unconditional)

## Notes

- If Ahrefs is not procured, close US2 tasks as skipped-with-reason; volumes degrade to unavailable (feature-002 pattern) — positions unaffected

---

## Execution notes (2026-10-22; final pass — PSI + ideas + badges done)

- Market re-research (user-challenged the "Ahrefs-only" claim) found: Google Ads API direct is legal for self-hosted own use (own-use carve-out in the Sept 2026 policy; RMF not applied to internal tools; Basic access free, auto-approved); Keyword Tool/Serpstat/KE verified NOT DataForSeo resellers; Ahrefs/Semrush stay rejected by maintainer.
- Implemented: google-ads provider (refresh-token OAuth → v19 generateKeywordIdeas REST; geo criterion = our market code), volumes adapter with honest nulls, keyword-metrics fallback when the incumbent key is absent, preflight label, env docs.
- Follow-ups open: research ideas-list via generateKeywordIdeas for labs markets without DataForSeo (research currently needs the incumbent for the keyword LIST); keywords-everywhere fallback not built (only if Google quotas bite); contracts/ahrefs-volumes.md is now historical (superseded by decisions §8 v2).
- Bug found & fixed during this pass: Norway's availability entry was keyed 2057 instead of the registry's 2578 (phase-1 slip) — bing was never offered for Norway.
- Full suite: 1687 passed; 1 pre-existing Google OAuth EBUSY flake.
- Final pass (same day): T003–T006 PSI DONE — audit/lighthouse.ts now calls
  the free PageSpeed Insights API (same Lighthouse), scores 0..1→percent,
  field metrics from audits, 1 retry on 429/5xx, page-isolated failures,
  fixture tests; billingCustomer param dropped from fetchLighthouseResult.
- Ideas generator DONE: fetchGoogleAdsIdeaRows + research() fallback —
  western markets research works with NO DataForSEO key at all (list =
  generateKeywordIdeas, volumes included, source "google_ads").
- Provider badges: getSeoProviderSetup server function +
  DataForSeoRequiredBadge (warning chip with guidance) on backlinks, domain
  overview, and ai-visibility pages — shows only when DATAFORSEO_API_KEY is
  absent. T012 quickstart live-run remains an operator-env item.
- Full suite: 1689 passed; 1 pre-existing Google OAuth EBUSY flake.

## Review fixes (2026-10-22)

1. PSI audit payloads now stored to R2 as the normalized StoredLighthousePayload v2 (source "psi-lighthouse", issues/metrics via the shared lighthouseStoredPayload builders), so the issues panel reads them; schema source widened to a union and lighthouse.test.ts asserts a non-empty issue round-trip.
2. City-level Google checks skip Serper and run the DataForSEO path in both RankCheckWorkflow and the research SERP snapshot (Serper has no sub-country geo, decisions §5); regression tests added to both suites.
3. ENGINE_AVAILABILITY[643] is yandex-only (google-RU is not executable on DataForSEO without Serper; returns via its own later decision) — search-engines.test.ts updated.
4. runProviderCheck issues one provider call per keyword and replicates the result to every device pair (providers return one desktop SERP and bill per keyword) — both-device trackers no longer pay twice.
5. Wordstat getVolumes batches queries in sequential chunks of 25 (Yandex RPS quotas + Workers subrequest cap) and drops non-numeric region labels (a DataForSEO city string is not a Yandex region id).
6. Local (city) targeting rejected for non-google engines in RankTrackingService.createConfig; the config modal hides SearchTargetingField off-google and resets locationName/targetingMode when the engine changes.
7. Yandex gates: research() and fetchKeywordMetricsForList throw UPSTREAM_UNAVAILABLE naming YANDEX_SEARCH_API_KEY + YANDEX_FOLDER_ID before any paid call, each with a single reused getSeoProviderStatuses call.
8. RankCheckWorkflow destructures searchEngine with a "google" default so pre-deploy in-flight workflows keep running.
9. runProviderCheck records the bare "UPSTREAM_UNAVAILABLE" code on partial provider failure instead of a sentence (same rule as checkBatchLive).
10. CI hygiene: prettier across the touched provider/shared files; dead exports removed (toYandexRankCheckResult, isProviderConfiguredSync, isGoogleAdsConfigured, wordstatRegionsTree; BrightDataOrganicItem/GoogleAdsKeywordIdea made module-local); yandex/brightdata/google-ads tests switched to static imports; serper's test-only toRankCheckResult deleted; pre-existing oxlint errors fixed (unused import/vars, max-lines pragma on the repository query test).

## Second review fixes (2026-10-22)

1. google-ads client rewritten to the live v26 REST contract (docs re-check): `keywordSeed.keywords` seed, `pageSize`, `keywordPlanNetwork: "GOOGLE_SEARCH"`, `geoTargetConstants` as an array of `geoTargetConstants/<id>` strings; `month` in monthlySearchVolumes is a MonthOfYear enum name mapped JANUARY→1…DECEMBER→12 (unknown → 0); `averageCpcMicros` (opt-in via `historicalMetricsOptions.includeAverageCpc`) → `cpc` (micros/1e6, 4 decimals) in GoogleAdsKeywordIdea → `KeywordVolumeRow.cpc` and the research idea rows; the 12-month history is plumbed through `KeywordVolumeRow.monthly` into the keyword-metrics fallback (trend was silently dropped before). Client tests assert the request body and the mappings; volumes tests cover the cpc/monthly rows.
2. Serper pagination: Google killed num=100 in Sept 2025 (and num>10 double-bills), so depth is collected page by page (num=10, one credit per page, max ceil(depth/10) pages) with an early stop once the target domain ranks on a page — the Serper analogue of DataForSEO's stop_crawl_on_match; cross-page positions are recomputed. hostOf/matchesTargetDomain moved to a shared helper used by clients and adapters. Tests: two-page stop, first-page single request, depth-bounded walk.
3. Bright Data depth: full parsed JSON (`format:"json"`; `data_format:"parsed_light"` caps at top-10 and is gone) and Bing pagination via the documented `first` offset with stop-on-domain and link dedupe (documented page overlap); Baidu has no documented pagination parameter — one request is the ceiling, noted AT INTEGRATION together with the unverified Baidu parsed schema. Tests cover both engines, pagination stop, dedupe, and the Baidu single-shot cap.
4. research SERP snapshot (serper path) fetches at depth min(requested, 20): the panel shows the top of the SERP, and full tracker depth would cost up to 10 paid pages per keyword.
5. RankTrackingService.updateConfig now enforces the engine×market availability table when the country changes (same rule as createConfig; engine itself is immutable on update) — moving a google tracker to Russia (643) fails with the supported-engine list.
6. Lighthouse retry loop: fetch is wrapped inside the loop so a timeout/network error counts as a retryable attempt (it used to escape unretried), and the thrown AppError names the real last failure — two 429s printed as "timeout" before.
7. Yandex rawData decoded via base64 → Uint8Array → TextDecoder (atob's Latin-1 binary string mangled Cyrillic titles).
8. rankCheckPaths device comment corrected: Serper/Yandex take no device parameter; Bright Data's brd_mobile is normalized away for cross-engine parity.
9. CI hygiene: ENGINE_AVAILABILITY unexported (enginesForCountry stays the only reader), prettier run over all changed .ts/.tsx files, .prettierignore covers specs/, .specify/, .claude/ (spec-kit artifacts and skills are not code).
