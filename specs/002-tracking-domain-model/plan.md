# Implementation Plan: Multi-Engine Rank Tracking Domain Model

**Branch**: `002-tracking-domain-model` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-tracking-domain-model/spec.md`

## Summary

Rank trackers gain a `searchEngine` column (default google) with
engine-aware uniqueness; Russia (643, ru) and China (156, zh) become
selectable markets with engine metadata; UI tracker forms and the
create/read MCP tools accept and expose the engine. Non-Google trackers
report "provider not configured for this engine" on their first check —
collection itself lands in features 003–005.

## Technical Context

**Language/Version**: TypeScript 5 (strict); Drizzle ORM; Zod.

**Primary Dependencies**: Drizzle migrations (pg + sqlite), feature 001's
`search-engines.ts`, existing `keyword-locations.ts`,
`src/types/schemas/rank-tracking.ts` + `projects.ts`, MCP tool
input/output schemas.

**Storage**: `rank_tracking_configs.search_engine` (text, NOT NULL,
default 'google'); partial unique indexes rebuilt to include it. No other
table changes (results are provider-neutral already).

**Testing**: Vitest. Schema round-trip in both dialects; Zod validation
tests; MCP tool tests follow existing `create-rank-tracker` patterns.

**Target Platform**: Cloudflare Workers + Docker self-host (PG/SQLite).

**Project Type**: web-service.

**Performance Goals**: N/A.

**Constraints**: existing trackers read as google with zero operator
action; engine options always match shared availability (SC-002).

**Scale/Scope**: 1 migration per dialect; ~10 files touched.

## Constitution Check

| Principle | Status | Notes |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS | One nullable-free column + two index rebuilds; no polymorphic tracker tables, no engine-config JSON. |
| II. Verified Trust Boundaries | PASS | Engine input validated by Zod against the shared availability table at form, server function, and MCP boundaries. |
| III. Dual-Dialect Persistence | PASS | Migrations authored for pg and sqlite with identical semantics; index rebuild SQL checked against both. |
| IV. Provider Normalization at the Boundary | PASS | Availability comes from the shared table; no provider names leak into tracker domain. |
| V. Tests Enforce Real Behavior | PASS | Tests create trackers through the service/MCP entry points and assert persisted engine + uniqueness, not migration internals. |

## Project Structure

### Documentation (this feature)

```text
specs/002-tracking-domain-model/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── tracker-engine-api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── db/
│   ├── app.schema.ts                # rankTrackingConfigs.searchEngine
│   └── pg/ (mirror)                 # same column
├── drizzle/
│   ├── pg/0038_*.sql                # add column + rebuild 2 partial uniques
│   └── sqlite/0060_*.sql            # same, sqlite dialect
├── shared/
│   ├── keyword-locations.ts         # Russia 643, China 156 + engine metadata
│   └── search-engines.ts            # availability entries for 643/156/2057(bing)
├── types/schemas/
│   ├── rank-tracking.ts             # searchEngineField + availability refine
│   └── projects.ts                  # 643/156 pass isSupportedLocationCode
├── server/
│   ├── features/rank-tracking/services/RankTrackingService.ts   # persist engine
│   └── mcp/tools/create-rank-tracker.ts, get-rank-tracker.ts, estimate-rank-tracker-cost.ts
└── client/ (tracker form components — engine select)

tests: keyword-locations.test.ts, keyword-locations.vendor-defaults.test.ts,
       rank-tracking schema tests, MCP tool tests
```

**Structure Decision**: engine lives on the tracker row (not a join table)
— one tracker tracks exactly one engine by definition; uniqueness extends
the existing partial indexes rather than adding new ones.

## Complexity Tracking

No violations. One deliberate simplification: `locationName` (city) stays
nullable and engine-agnostic; per-engine city registries arrive with their
provider phases (003/004).
