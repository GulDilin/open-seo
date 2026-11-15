# Implementation Plan: Google Rank Checks via Serper

**Branch**: `003-serper-google-provider` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-serper-google-provider/spec.md`

## Summary

First live provider on the 001 skeleton: a Serper adapter serves Google
rank checks (single `num=100` request, domain+subdomain matching) and
keyword SERP snapshots, wired into the rank-check workflow's provider
selection so Serper-configured deployments stop calling DataForSeo for
Google, and DataForSeo-only deployments are byte-for-byte unchanged.

## Technical Context

**Language/Version**: TypeScript 5 (strict).

**Primary Dependencies**: feature 001 (`SerpProvider`, resolver),
feature 002 (engine on trackers); existing `RankCheckWorkflow.ts`
(live/queue selection at the tracker-check entry), `scheduledRankChecks.ts`
(budget units), `research/serp.ts` (snapshot + R2 cache), AppError types.

**Storage**: none new — results reuse existing rank-check result storage;
snapshots reuse the existing R2 cache.

**Testing**: Vitest with fixture-based adapter tests (real response shape
recorded once); workflow tests follow `RankCheckWorkflow.test.ts` mocks of
the provider boundary only.

**Target Platform**: Cloudflare Workers + Docker self-host; Serper is a
plain HTTPS JSON API (fits Workers fetch).

**Project Type**: web-service.

**Performance Goals**: single HTTP request per keyword check; ≤2s provider
latency (provider's own SLA).

**Constraints**: depth ≤100 (single-request cap, clamped with notice);
one budget unit per keyword check; no retry on 4xx.

**Scale/Scope**: ~5 new files; workflow selection branch; snapshot switch.

## Constitution Check

| Principle | Status | Notes |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS | One client (single endpoint), one adapter; no generic HTTP framework; `num=100` replaces the incumbent's page-crawl loop with a flatter call. |
| II. Verified Trust Boundaries | PASS | Adapter validates the provider response with Zod before normalization; keyword input already validated upstream; errors map to AppError with provider id. |
| III. Dual-Dialect Persistence | N/A | No schema change. |
| IV. Provider Normalization at the Boundary | PASS | Serper wire format (organic[], position from array) normalized to `SerpRankResult` inside the adapter; feature code consumes only the internal type. |
| V. Tests Enforce Real Behavior | PASS | Adapter tested through `checkRank` with response fixtures; workflow tested through its public entry with the provider port mocked (mapping IS the contract here). |

## Project Structure

### Documentation (this feature)

```text
specs/003-serper-google-provider/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── serper-adapter.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/lib/seo-providers/
├── serper/
│   ├── client.ts             # POST google.serper.dev/search, X-API-KEY, num=100
│   ├── adapter.ts            # SerpProvider impl: checkRank + snapshot mapping
│   ├── serper.test.ts        # fixture-driven
│   └── fixtures/serper-response.json
├── routing.ts                # register serper as live google provider

src/server/workflows/
├── RankCheckWorkflow.ts      # provider selection: engine+chain → provider path
└── RankCheckWorkflow.test.ts

src/server/features/rank-tracking/services/
└── scheduledRankChecks.ts    # unit accounting: 1 unit/keyword (serper path)

src/server/features/keywords/services/research/
└── serp.ts                   # snapshot source switch (active google provider)
```

**Structure Decision**: adapter owns both mapping directions (request
params, response → internal); the workflow knows only `SerpProvider`.
Live-only for Serper (no queue product to mirror DataForSeo's task_post).

## Complexity Tracking

No violations. Deliberate simplification: snapshot switch reuses the
existing cache key/versioning (`ponytail:` note — revisit only if Serper
snapshots need different TTL semantics).
