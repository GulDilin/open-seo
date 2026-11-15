# Implementation Plan: Russia Tracking — Yandex + Wordstat

**Branch**: `004-yandex-russia-tracking` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-yandex-russia-tracking/spec.md`

## Summary

Yandex Search API adapter serving Russia-market trackers — immediate
collection for manual checks, deferred (16× cheaper) collection for
scheduled runs — plus a Wordstat `KeywordDataProvider` powering Russian
volumes in research and metric refresh, and a cached searchable Russian
region directory. Russia-market research lists build from provider
suggested queries; difficulty/intent show honest "unavailable".

## Technical Context

**Language/Version**: TypeScript 5 (strict).

**Primary Dependencies**: features 001–003 (contracts, engine model,
provider-path pattern); Yandex Search API (REST, service-account API key +
folder id headers); Workers KV (region cache, mirroring `serp-locations`
pattern); existing research services (`research-data.ts`,
`local-volume.ts` analog, `refresh-metrics.ts`), `keyword-metrics.ts`
normalization target `KeywordMetricRow`.

**Storage**: KV namespace `yandex-regions` (TTL 30d). No relational
schema changes; wordstat volumes stored through the existing
keyword-metrics path with `source: "wordstat"`.

**Testing**: Vitest, fixture-driven client/adapter tests; deferred-flow
tests assert submit→poll→collect state transitions with a fake poller.

**Target Platform**: Cloudflare Workers + Docker self-host.

**Project Type**: web-service.

**Performance Goals**: manual check ≤ sync provider latency; scheduled
batches paced within Yandex quotas.

**Constraints**: quotas per cloud folder (observed at integration, tuned
in scheduler units); rub-denominated billing external to the app.

**Scale/Scope**: ~8 new files; research routing branch for market 643;
region picker UI.

## Constitution Check

| Principle | Status | Notes |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS | One client module per API family (search, wordstat) — not a generic multi-vendor SERP framework; deferred mode mirrors the incumbent task_post/task_get shape the codebase already knows. |
| II. Verified Trust Boundaries | PASS | All provider responses Zod-validated at the adapter; region ids validated as integers against the directory cache before use. |
| III. Dual-Dialect Persistence | PASS | No new tables; volumes flow through existing keyword-metrics storage used by both dialects. |
| IV. Provider Normalization at the Boundary | PASS | Yandex wire formats (urls, passes, wordstat fields) normalize to `SerpRankResult`/`KeywordVolumeRow` inside `seo-providers/yandex/`. |
| V. Tests Enforce Real Behavior | PASS | Adapter tested via public methods with recorded fixtures; no HTTP mocking libraries beyond the client boundary; deferred state machine tested by outcomes. |

## Project Structure

### Documentation (this feature)

```text
specs/004-yandex-russia-tracking/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── yandex-adapter.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/lib/seo-providers/yandex/
├── client.ts            # auth headers, sync search, deferred submit/poll, wordstat
├── serp-adapter.ts      # SerpProvider: yandex engine, region-aware
├── wordstat.ts          # KeywordDataProvider: GetTop volumes (+regional)
├── regions.ts           # GetRegionsTree fetch + KV cache + search
├── yandex.test.ts, fixtures/

src/server/features/keywords/services/research/
├── research-data.ts     # market 643 branch: wordstat volume + provider suggestions
└── refresh-metrics.ts   # 643 → wordstat refresh

src/server/features/rank-tracking/services/
└── scheduledRankChecks.ts   # deferred batch pacing for yandex engine

src/client/ (region picker component for Russia market trackers/research)
```

**Structure Decision**: three modules in one provider folder (client /
adapters / directory) mirroring the repo's `lib/dataforseo` one-file-per-
API-section convention.

## Complexity Tracking

No violations. Deliberate: deferred collection poll happens inside the
scheduler tick (no durable queue machinery) — `ponytail:` ceiling noted;
move to a workflow-queued poller only if batches exceed the tick window.
