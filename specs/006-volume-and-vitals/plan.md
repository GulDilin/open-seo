# Implementation Plan: Non-Russia Volumes and Free Vitals

**Branch**: `006-volume-and-vitals` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-volume-and-vitals/spec.md`

## Summary

Two independent slices: (P1) audit page vitals switch from the incumbent's
paid Lighthouse endpoint to Google's free PageSpeed Insights API,
normalized into the existing stored payload — audits stop requiring the
incumbent credential for vitals; (P2, conditional on procurement) an
optional Ahrefs-backed `KeywordDataProvider` for markets the incumbent
served, activating only when its credential is present and degrading to
honest "unavailable" when not.

## Technical Context

**Language/Version**: TypeScript 5 (strict).

**Primary Dependencies**: PSI API (free, keyless-friendly, `lighthouseResult`);
existing `src/server/lib/audit/lighthouse.ts` normalization +
`StoredLighthousePayload`; existing `keyword-metrics.ts` merge path;
Ahrefs API v3 (optional; units-billed subscription) behind the 001
`KeywordDataProvider` contract.

**Storage**: none new (existing audit payload + keyword metrics shapes).

**Testing**: Vitest; PSI fixture (public shape, stable for years);
wordstat-pattern tests for the volume adapter.

**Target Platform**: Cloudflare Workers + Docker self-host.

**Project Type**: web-service.

**Performance Goals**: PSI pacing to stay inside free quotas (audit pages
are bounded by crawl size).

**Constraints**: vitals scores stay variance-comparable to the old source;
volume fields only as the source provides (SC-003: no fabricated numbers).

**Scale/Scope**: vitals ~2 files changed; volumes ~4 new files.

## Constitution Check

| Principle | Status | Notes |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS | Vitals is a source swap in one module; volumes is the third instantiation of the existing provider contract — nothing new invented. |
| II. Verified Trust Boundaries | PASS | Both provider responses Zod-validated; per-page failures isolated. |
| III. Dual-Dialect Persistence | N/A | No schema change. |
| IV. Provider Normalization at the Boundary | PASS | PSI and Ahrefs wire formats normalized inside their modules. |
| V. Tests Enforce Real Behavior | PASS | Vitals: one normalization test against a recorded fixture + one pacing test. Volumes: adapter contract tests. |

## Project Structure

### Documentation (this feature)

```text
specs/006-volume-and-vitals/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/
│   ├── psi-vitals.md
│   └── ahrefs-volumes.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/lib/audit/
└── lighthouse.ts          # PSI source swap + pacing; normalization target unchanged

src/server/lib/seo-providers/ahrefs/
├── client.ts              # keywords volume endpoints, country param
├── volumes.ts             # KeywordDataProvider impl
└── ahrefs.test.ts + fixtures/

src/server/features/keywords/services/research/
└── research-data.ts       # volume source routing: market → incumbent | wordstat | ahrefs | unavailable
routing.ts                 # keyword-data chain extension (ahrefs optional)
```

**Structure Decision**: two unrelated slices share a spec because both are
small and optional-phase; they ship as separate PRs and either can be
dropped independently.

## Complexity Tracking

No violations. Conditional slice documented as such (P2 activates only
with a credential — no speculative UI for unconfigured providers).
