# Implementation Plan: Baidu and Bing via Bright Data

**Branch**: `005-brightdata-baidu-bing` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-brightdata-baidu-bing/spec.md`

## Summary

Bright Data SERP adapter serving the Baidu engine (China market) and the
Bing engine (markets declaring it), on the exact pattern established by
feature 003: one client, one adapter, provider-path selection already in
place from 003's workflow branch. Live-only collection; validation-first
availability (no paid calls for impossible engine/market pairs).

## Technical Context

**Language/Version**: TypeScript 5 (strict).

**Primary Dependencies**: features 001–003 (contracts, availability,
workflow provider branch); Bright Data SERP API (HTTPS JSON, bearer-style
token).

**Storage**: none new.

**Testing**: Vitest fixture-driven (Baidu and Bing response shapes); workflow
tests extend 003's with engine parameters.

**Target Platform**: Cloudflare Workers + Docker self-host.

**Project Type**: web-service.

**Performance Goals**: one request per keyword check per engine.

**Constraints**: operator-owned Bright Data account (jurisdiction
restrictions are the operator's concern — documented, not coded); Sogou/
360 unsupported (declared limitation).

**Scale/Scope**: ~4 new files + routing registration; no schema/UI changes
(engine pickers already render from availability).

## Constitution Check

| Principle | Status | Notes |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS | Second instantiation of the existing seam; no new abstraction. |
| II. Verified Trust Boundaries | PASS | Zod-validated responses; engine/market validated against availability BEFORE any provider request (FR/spec SC-003). |
| III. Dual-Dialect Persistence | N/A | No schema change. |
| IV. Provider Normalization at the Boundary | PASS | Bright Data wire shapes normalized inside `seo-providers/brightdata/`. |
| V. Tests Enforce Real Behavior | PASS | Same fixture-through-public-method pattern as 003. |

## Project Structure

### Documentation (this feature)

```text
specs/005-brightdata-baidu-bing/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/brightdata-adapter.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/lib/seo-providers/brightdata/
├── client.ts            # SERP API call, engine=baidu|bing, geo params
├── adapter.ts           # SerpProvider impl (both engines)
├── brightdata.test.ts + fixtures/ (baidu.json, bing.json)
routing.ts               # brightdata live for baidu/bing chains
```

**Structure Decision**: single adapter serves both engines (same API,
same mapping logic); engine is a request parameter, not a code path fork.

## Complexity Tracking

No violations.
