---
description: "Task list for incumbent exit from rank tracking"
---

# Tasks: Retiring the Incumbent from Rank Tracking

**Input**: Design documents from `/specs/007-dataforseo-serp-exit/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable; **[Story]**: US1 fleet-only tracking, US2 honest dependency states

---

## Phase 1: Setup (gate — do not proceed without it)

- [ ] T001 Archive the 2-week parallel-run dataset proving SC-002 (±1 position ≥90% on the shared tracker set) under specs/007-dataforseo-serp-exit/parallel-run-evidence.md (summary + where raw logs live)

## Phase 2: User Story 1 — Fleet-only rank tracking (P1) 🎯 MVP

**Goal**: All engines collect without DATAFORSEO_API_KEY; incumbent never routed for fleet engines.
**Independent Test**: quickstart.md Scenarios A, B, E.

- [ ] T002 [US1] Change google chain to ["serper"] in src/shared/search-engines.ts; update table-integrity tests (no incumbent in any fleet-engine chain)
- [ ] T003 [US1] Split preflight in src/lib/selfhost-preflight.ts: "rank tracking ready (engines: …)" computed from fleet keys, independent of the incumbent row; incumbent row no longer implies tracking breakage
- [ ] T004 [US1] Workflow test: google check with BOTH keys set routes to serper (incumbent client never invoked — mock absence)
- [ ] T005 [US1] Update docs/DATAFORSEO_API_KEY.md + self-hosting docs: key now optional, needed only for backlinks/AI/local/domain data

## Phase 3: User Story 2 — Dependency states (P2)

**Goal**: Every incumbent-dependent surface states its need; others never mention it.
**Independent Test**: quickstart.md Scenario C (row-by-row against contracts/incumbent-dependency-map.md).

- [ ] T006 [US2] Backlinks surfaces (overview/profile/history + dashboard widgets): dependency empty state when key absent (stored data stays visible, refresh disabled with explanation) — src/server/features/backlinks/ + dashboard widget services
- [ ] T007 [P] [US2] AI visibility + AI search surfaces: same dependency state (schedules skip with named reason — extend the existing "operator must configure" skip path) — src/server/features/ai-visibility/, src/server/features/ai-search/
- [ ] T008 [P] [US2] Local SEO MCP tools + UI: tool errors and empty states name the incumbent — src/server/mcp/tools/local-seo-*.ts
- [ ] T009 [P] [US2] Domain overview surfaces (overview/ranked keywords/relevant pages/competitors): dependency state — src/server/features/domain/
- [ ] T010 [P] [US2] Keyword research for labs/ads markets without incumbent and without feature-006 provider: volumes explicit-unavailable (verify feature-002 pattern holds through the exit; add test if missing)
- [ ] T011 [US2] Marketing-site free tools (web/src/lib/free-tools/): document dependency; verify their error copy names the incumbent key (no behavior change)

## Phase 4: Polish & Cross-Cutting

- [ ] T012 Rollback drill (quickstart Scenarios D): remove key → walk dependency map → re-add → backlinks works with history intact; record results
- [ ] T013 Run quickstart.md scenarios A–E end-to-end; audit the dependency map checklist row by row
- [ ] T014 [P] Update docs/maintainers/provider-migration/provider-replacement-tasks.md checkboxes T6.1–T6.2; record the keep/replace decision per remaining incumbent role (backlinks/AI/local/domain) as separate future features or explicit "keep"

---

## Dependencies & Execution Order

- T001 gates everything (evidence first)
- US1 (T002–T005) before US2 surface states (states assume fleet-only tracking)
- T006–T011 parallelizable (different feature areas)

## Notes

- Exit = routing + honesty. No deletion of lib/dataforseo; rollback is re-adding a key
- Full incumbent removal is a separate future decision per remaining role
