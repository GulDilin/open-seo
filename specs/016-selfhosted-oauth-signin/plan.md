# Implementation Plan: Self-Hosted OAuth Sign-In

**Branch**: `016-selfhosted-oauth-signin` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/016-selfhosted-oauth-signin/spec.md`

## Summary

Add `AUTH_MODE=oauth`: self-hosted instances authenticate users by OAuth
sign-in (Google via the built-in provider, Yandex via the `genericOAuth`
plugin) against the operator's own already-documented OAuth clients, instead
of running `local_noauth` wide open. Real per-user accounts and workspaces
come from the existing Better Auth tables and the existing session→user→org
resolver; MCP clients authenticate with the existing API-key mechanism. Zero
schema changes. Full decisions with alternatives: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 22 / workerd runtimes.

**Primary Dependencies**: better-auth@1.6.22 (socialProviders.google,
`plugins/generic-oauth`, organization plugin, drizzleAdapter), TanStack Start
(server functions, file routes), Zod. No new packages.

**Storage**: existing Drizzle schema on SQLite (D1) and Postgres — no
migrations ([data-model.md](data-model.md): zero new tables).

**Testing**: Vitest (`pnpm vitest run`), behavior tests at public entry
points per Constitution V.

**Target Platform**: Docker self-host (Node/vite path) and self-hosted
Cloudflare Workers; both must keep working. Hosted deployment untouched.

**Project Type**: web app (TanStack Start monolith: `src/routes`,
`src/client`, `src/server`, `src/lib`).

**Performance Goals**: none new — sign-in adds one OAuth redirect; every
request path it touches (session resolution) is the hosted path already
serving production.

**Constraints**: no email infrastructure in the mode (OAuth-only);
build-time client `AUTH_MODE` must match runtime (existing contract);
fail-closed on misconfiguration (preflight + resolver, FR-008).

**Scale/Scope**: 1 new AUTH_MODE value, ~1 seam predicate pair, 1 provider
adapter (Yandex), docs. Touched files enumerated in Structure below.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-research | Post-design |
| --- | --- | --- |
| I. Simplicity Over Abstraction | PASS — the feature is a new value through existing pipes (modes table, session resolver, org hook, account table), not a new layer | PASS — the only new seam is the `isSessionAuthMode` predicate pair, which exists to *prevent* duplicating hosted logic; no new factories, no parallel auth builder |
| II. Verified Trust Boundaries | PASS plan; pinned in design — Zod on `AUTH_MODE` enum and Yandex userinfo; preflight fail-closed; MCP 401 anonymous | PASS — [data-model.md](data-model.md) lists each boundary and its rule; no user-controlled URLs fetched (fixed provider endpoints) |
| III. Dual-Dialect Persistence | PASS — zero schema changes | PASS — no queries beyond existing Better Auth/Drizzle paths, already dual-dialect |
| IV. Provider Normalization at the Boundary | N/A (identity, not SEO data) — same spirit applied | PASS — the Yandex adapter normalizes the provider profile at the boundary ([research.md](research.md) D4); no vendor shapes leak into app code |
| V. Tests Enforce Real Behavior | PASS plan | PASS — planned tests hit public entry points (mode dispatch, preflight, MCP transport, client guard); no ORM-chain mocks, no orphan exports |

No violations → no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/016-selfhosted-oauth-signin/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1–D8, alternatives, pinned facts
├── data-model.md        # Phase 1 — zero-schema entities, validation, transitions
├── quickstart.md        # Phase 1 — runnable end-to-end validation
├── contracts/
│   ├── operator-configuration.md   # AUTH_MODE=oauth env/preflight contract
│   └── signin-and-access.md        # pages, linking, 401/MCP auth contract
└── tasks.md             # /speckit-tasks output (next phase)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── auth-mode.ts                 # + "oauth" in AUTH_MODES; isSessionAuthMode / isSessionClientAuthMode
│   ├── auth.ts                      # oauth branch: real baseURL, provider clients, emailAndPassword off, API-key plugin on
│   └── selfhost-preflight.ts        # oauth requirements branch; local_noauth hint gains oauth alternative
├── middleware/ensure-user/
│   ├── resolve.ts                   # "oauth" → session resolver
│   └── hosted.ts                    # config check generalized (hosted vs oauth requirements)
├── server/auth/                     # (only if the Yandex provider config lands near its siblings)
├── server/lib/yandexSignIn.ts       # genericOAuth Yandex config: endpoints, scopes, Zod userinfo, profile map (name per repo layout; final home in tasks)
├── server/mcp/transport.ts          # authMode union + "oauth" → API key → session → 401
├── server/lib/setup-status.ts       # expose configured sign-in providers to the client
├── routes/_auth.sign-in.tsx         # provider buttons per configured providers; hide email/sign-up in oauth mode
├── client/features/auth/
│   ├── useHostedAuthRouteGuard.ts   # gate on isSessionClientAuthMode
│   └── AuthPage.tsx                 # useAuthPageState gains session-mode flag; Yandex button variant
├── client/ (settings API-key surface gate)  # widen isHostedClientAuthMode → session-mode predicate where it gates key management
└── deploy/.env.selfhost.example     # + AUTH_MODE=oauth block
docs/
├── SELF_HOSTING_DOCKER.md           # oauth mode section (env, redirect URIs, audience guidance)
└── SELF_HOSTING_CLOUDFLARE.md       # same section for the Workers path
```

Tests live beside their modules (repo convention): `auth-mode.test.ts`
extensions, `selfhost-preflight.test.ts` cases, `transport.test.ts` oauth
branch, `yandexSignIn.test.ts` userinfo mapping, client guard test.

**Structure Decision**: single-project monolith (repo layout above); the new
Yandex provider config is a leaf module beside existing server lib code —
exact path finalized in tasks, constraints: no imports from feature modules,
importable by `auth.ts` without cycles.

## Complexity Tracking

> No Constitution violations — table intentionally empty.
