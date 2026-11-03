# Implementation Plan: Retiring the Incumbent from Rank Tracking

**Branch**: `007-dataforseo-serp-exit` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-dataforseo-serp-exit/spec.md`

## Summary

After the 2-week parallel-run window passes tolerance: remove the
incumbent from the Google chain (fleet-covered engines never route to it),
declare rank tracking fully available without its credential in preflight,
and make every remaining incumbent-dependent surface (backlinks, AI
visibility, local listings, domain overview) state its dependency
explicitly when the credential is absent. No data deletion, no migration
— re-adding the credential restores those features as-is.

## Technical Context

**Language/Version**: TypeScript 5 (strict).

**Primary Dependencies**: features 001–005 accepted; parallel-run
evidence recorded (SC-002 dataset); preflight surface; per-feature empty
states (backlinks/ai-visibility/local/domain screens); estimates copy.

**Storage**: none new; nothing deleted (FR-004).

**Testing**: Vitest — chain assertions (google chain = [serper]);
dependency-state tests per surface (mock credential absence at the env
boundary).

**Target Platform**: Cloudflare Workers + Docker self-host.

**Project Type**: web-service.

**Performance Goals**: N/A.

**Constraints**: rollback = re-adding a credential, no repair steps
(FR-005); no incumbent traffic for fleet-covered engines even when its
credential exists (FR-002).

**Scale/Scope**: chain edit + ~6 surfaces' empty states + preflight copy
+ docs.

## Constitution Check

| Principle | Status | Notes |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS | This phase is mostly deletion of a fallback and honest copy — the cheapest kind of change. |
| II. Verified Trust Boundaries | PASS | Dependency states derive from the same credential-presence source (001) — no second env reader. |
| III. Dual-Dialect Persistence | N/A | No schema change. |
| IV. Provider Normalization at the Boundary | PASS | Exit is possible precisely because the boundary held; this phase proves it (no feature edits needed for the engines themselves). |
| V. Tests Enforce Real Behavior | PASS | Chain tests assert routing outcomes (the contract users rely on); surface tests assert the dependency copy per FR-003. |

## Project Structure

### Documentation (this feature)

```text
specs/007-dataforseo-serp-exit/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/incumbent-dependency-map.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/shared/search-engines.ts          # google chain: ["dataforseo" removed]
src/lib/selfhost-preflight.ts         # tracking availability independent of incumbent key
src/server/features/backlinks/        # dependency empty state when key absent
src/server/features/ai-visibility/    # same
src/server/mcp/tools/local-seo-*      # same (or tool error copy)
src/server/features/domain/           # same for domain overview
docs/SELF_HOSTING_*.md, docs/DATAFORSEO_API_KEY.md   # re-scoped: optional, needed only for backlinks/AI/local/domain
```

**Structure Decision**: no removal of incumbent client code — the exit is
routing + honesty, not deletion. Deleting `lib/dataforseo` happens only
with the separate keep/replace decisions for the remaining roles.

## Complexity Tracking

No violations. Deliberate non-deletion recorded above (deleting a working
provider for roles still using it would be churn, not simplicity).
