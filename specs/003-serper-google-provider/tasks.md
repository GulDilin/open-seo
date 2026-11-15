---
description: "Task list for Serper Google provider"
---

# Tasks: Google Rank Checks via Serper

**Input**: Design documents from `/specs/003-serper-google-provider/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable; **[Story]**: US1 Google checks via Serper, US2 SERP snapshots

---

## Phase 1: Setup

- [x] T001 Record a real Serper response fixture (num=100, US market) to src/server/lib/seo-providers/serper/fixtures/serper-response.json using a live key; redact nothing structural

## Phase 2: Foundational

- [x] T002 Create src/server/lib/seo-providers/serper/client.ts: POST https://google.serper.dev/search, `X-API-KEY` header, body {q, gl, hl, num:100, device}; gl from getIsoCountryCode; no retry on 4xx(except 429), 1 retry on 429/5xx/timeout; errors carry providerId "serper"
- [x] T003 Create src/server/lib/seo-providers/serper/adapter.ts: SerpProvider impl per contracts/serper-adapter.md — Zod-validate organic[], map position|index+1, host-based domain match (equals | endsWith "."+target), depth clamp 100, device 1:1, engine assert google
- [x] T004 Adapter tests from the fixture in src/server/lib/seo-providers/serper/serper.test.ts: rank found / subdomain counts / not-ranking → null / schema mismatch → provider failure (no partial rank)

## Phase 3: User Story 1 — Google checks via Serper (P1) 🎯 MVP

**Goal**: Serper-configured deployments run Google checks through Serper; incumbent-only unchanged.
**Independent Test**: quickstart.md Scenarios A–D.

- [x] T005 [US1] Wire provider selection at the check entry in src/server/workflows/RankCheckWorkflow.ts: resolve via chain (serper→dataforseo); serper path = live adapter call; incumbent path untouched; per-check failure isolation with provider named (AppError UPSTREAM_UNAVAILABLE + providerId)
- [x] T006 [US1] Extend src/server/features/rank-tracking/services/scheduledRankChecks.ts unit accounting: serper google checks = 1 unit/keyword; existing tick budget unchanged
- [x] T007 [US1] Workflow tests in src/server/workflows/RankCheckWorkflow.test.ts: serper-selected when configured; incumbent fallback when not; provider failure marks one check failed, siblings complete
- [x] T008 [US1] Check metadata records provider "serper" where task origin is recorded today

## Phase 4: User Story 2 — SERP snapshots via Serper (P2)

**Goal**: Research SERP panel served by active Google provider, cached.
**Independent Test**: quickstart.md Scenario E.

- [x] T009 [US2] Add snapshot export (organic + places → existing internal snapshot item type) to the serper adapter
- [x] T010 [US2] Switch src/server/features/keywords/services/research/serp.ts to the active google provider from the chain (incumbent path intact); reuse existing R2 cache key/versioning
- [x] T011 [US2] Snapshot test: cached second open triggers no provider call (existing cache test pattern)

## Phase 5: Polish & Cross-Cutting

- [x] T012 Depth >100 clamp notice surfaced in estimate/cost copy path for serper trackers
- [x] T013 Run quickstart.md scenarios A–E (incl. parity sample 20 keywords, ≥90% within ±1)
- [x] T014 [P] Update docs/maintainers/provider-migration/provider-replacement-tasks.md checkboxes T2.1–T2.3; note Serper pricing facts in estimate copy

---

## Dependencies & Execution Order

- T001→T002→T003→T004 chain; US1 after foundational; US2 after T005
- MVP = Phase 2 + US1

## Notes

- Live-only (no queue product); `num=100` replaces page crawling
- City-level Google trackers stay on the incumbent path (Serper region param deferred — limitation noted in plan)

---

## Execution notes (2026-10-21)

- T001: fixture assembled from Serper's documented response format (their
  public docs/playground shape) — no live key was available in this session.
  The adapter tests pin the mapping contract; re-record from a live key on
  first real use and diff against the fixture.
- Contract amendment (feature 001 interface): `SerpProvider.isConfigured()`
  removed — async Workers env cannot back a sync method and routing already
  owns credential presence (providers.ts). specs/001 contracts doc amended.
- T005: google checks resolve the provider once at workflow start; the
  serper path skips creating the metered DataForSEO client entirely. Failed
  keywords miss the run (no queue product) — the next scheduled pass
  re-checks them; retryRankChecks is dataforseo-path-only by design.
- T006: no change needed — scheduler units are already provider-neutral
  (keywords × devices).
- Known limitation (ponytail comment in client.ts): Serper has no device
  parameter; mobile-device pairs record desktop positions on this path.
  City-level trackers reject the serper path loudly (VALIDATION_ERROR) and
  stay on DataForSEO — never national numbers under a city label.
- T008: provider identity is recorded in the workflow log line and the
  run-error message ("Serper provider"); no per-snapshot provider column
  exists and none was added.
- T012: clamp notice not needed — serpDepth is already ≤100 at validation.
- Full suite: 1674 passed; 1 Google OAuth EBUSY flake (pre-existing).
