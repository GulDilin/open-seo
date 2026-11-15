# Implementation Plan: Provider Foundation

**Branch**: `001-provider-foundation` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-provider-foundation/spec.md`

## Summary

Add optional credentials for Serper, Yandex Search API, and Bright Data with
preflight visibility, plus the shared skeleton future phases plug into:
`SearchEngine`/provider-chain types, a shared engine-availability table read
by UI and server alike, and a provider resolver that walks the chain.
Zero behavior change when no new credentials are set.

## Technical Context

**Language/Version**: TypeScript 5 (strict), ESLint per repo config.

**Primary Dependencies**: Zod (validation), existing `runtime-env.ts` for
env access, existing selfhost-preflight surfacing. No new packages.

**Storage**: None (configuration presence only).

**Testing**: Vitest, colocated `*.test.ts`, per repo testing rules.

**Target Platform**: Cloudflare Workers + Node/Docker self-host.

**Project Type**: web-service.

**Performance Goals**: N/A (no request path added).

**Constraints**: zero behavior change with empty new env; secret values
never rendered to UI.

**Scale/Scope**: 4 env vars; ~6 new files; ~5 existing files touched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS with note | Interfaces ship before second implementations exist — justified by Constitution IV: the provider boundary is a mandated architectural seam, not speculative flexibility. The resolver is a table walk, not a framework. |
| II. Verified Trust Boundaries | PASS | Zod schemas for engine names and credential presence; preflight renders status only, never values. |
| III. Dual-Dialect Persistence | N/A | No schema change in this feature. |
| IV. Provider Normalization at the Boundary | PASS | This feature creates the boundary the principle names. |
| V. Tests Enforce Real Behavior | PASS | Tests target the availability table and resolver through public exports; no ORM, no HTTP. |

## Project Structure

### Documentation (this feature)

```text
specs/001-provider-foundation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── provider-interface.md
│   └── engine-availability.md
└── tasks.md             # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
src/
├── shared/
│   └── search-engines.ts           # SearchEngine, SERP_PROVIDER_CHAIN,
│                                   # ENGINE_AVAILABILITY, searchEngineField (Zod)
└── server/
    └── lib/
        └── seo-providers/
            ├── types.ts            # SerpProvider, KeywordDataProvider, IO types
            ├── routing.ts          # resolveSerpProvider, provider statuses
            ├── providers.ts        # id → {isConfigured, engines} registry (no HTTP yet)
            └── routing.test.ts

touched:
  src/server/lib/runtime-env.ts     # optional reads for 4 new vars
  src/lib/selfhost-preflight.ts     # provider status entries
  .env.example, web/.env.example, docs/SELF_HOSTING_*.md
```

**Structure Decision**: shared table in `src/shared` (UI and server both
import it — Constitution IV); provider code under
`src/server/lib/seo-providers/` mirroring the existing `lib/dataforseo/`
convention.

## Complexity Tracking

No constitution violations to justify. The only abstraction-before-use
(provider interfaces) is the boundary Constitution IV mandates; recorded
above as PASS-with-note.
