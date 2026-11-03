<!--
Sync Impact Report
- Version change: (none — raw template placeholders) → 1.0.0
- Modified principles: none (initial ratification; all five principles created)
- Added sections: Core Principles I–V; "Technical & Product Constraints";
  "Development Workflow"; Governance
- Removed sections: none
- Follow-up TODOs: none — all placeholders resolved from AGENTS.md, specs under
  docs/maintainers/specs/, and docs/maintainers/provider-migration/
-->

# OpenSEO Constitution

## Core Principles

### I. Simplicity Over Abstraction

Every change ships the simplest readable solution: flat code, minimal
indirection, no speculative flexibility.

- MUST NOT add an abstraction with a single implementation, a factory for one
  product, or configuration for values that never change.
- MUST reuse existing project helpers, installed libraries, and platform
  features before introducing new dependencies or hand-rolled equivalents.
- Deletion beats addition; boring beats clever. Rationale: this codebase is
  maintained by agents and humans at 3am — indirection is where correctness
  goes to die.

### II. Verified Trust Boundaries

All untrusted input is validated and all outbound access is scoped at the
boundary where data enters or leaves the system.

- Untrusted data MUST be narrowed with Zod at trust boundaries (API inputs,
  provider responses, MCP tool arguments).
- Server-side fetching of user-supplied URLs MUST go through the existing
  SSRF-safe helpers; new fetch paths are reviewed against them.
- Every query and mutation MUST be tenant-scoped by construction (service →
  repository), never by caller discipline.
- Hosted billing seams MUST route through the metered provider client;
  importing raw provider fetchers in feature code is treated as billing bypass.

### III. Dual-Dialect Persistence

SQLite and Postgres are both first-class runtimes.

- Every schema change, query, and mutation MUST behave identically on SQLite
  and Postgres; migrations MUST ship for both dialects in the same change.
- Product data stays normalized with explicit relationships. Relational data
  MUST NOT be encoded in JSON or text to avoid joins.

### IV. Provider Normalization at the Boundary

External SEO/LLM data providers are adapters, not foundations.

- Each provider module (DataForSeo, Serper, Yandex, Bright Data) MUST
  normalize wire formats to internal camelCase types inside its adapter;
  vendor item types, snake_case fields, and vendor filter DSL MUST NOT leak
  into feature services, workflows, or MCP tools.
- Provider routing (engine, country) lives in `src/shared` so UI, server, and
  MCP validation read one table and cannot drift.
- Replacing or adding a provider MUST NOT require changes outside its adapter
  and the routing table. Rationale: the provider migration
  (docs/maintainers/provider-migration/) exists because this rule was absent
  for DataForSeo.

### V. Tests Enforce Real Behavior

A test exists to enforce core behavior or a plausible edge case — nothing else.

- Tests MUST exercise the public entry point (service object, tool handler,
  workflow); modules are statically imported, with no per-test `await import()`
  or `vi.resetModules()` ceremonies.
- One test per invariant. Never re-test Zod, a library, or argument forwarding
  unless that mapping IS the contract (billing params, telemetry events).
- Never re-declare a production class in a test, never mock ORM builder
  chains, never export a function only for a test (Knip fails CI on it).
- A negative test MUST fail for the reason its name gives.

## Technical & Product Constraints

- Stack: TypeScript, TanStack Start (server functions → service → repository),
  TanStack Query / Router / Form, Drizzle, Zod, shadcn components on Base UI
  (composed via the `render` prop, never `asChild`).
- Runtime targets: Cloudflare Workers (hosted and self-host) and Docker
  self-host; both MUST keep working.
- SEO data sources are pluggable providers behind the routing table
  (`src/shared/search-engines.ts` and
  `docs/maintainers/provider-migration/`); the product supports multiple
  search engines (Google, Yandex, Baidu, Bing) keyed by market.
- `docs/` (except `docs/maintainers/`) and `web/content/docs/` are
  user-facing: only material that helps users understand, use, or self-host
  the product. Engineering notes live in `docs/maintainers/`.
- Work on bugs a real user hit or would plausibly hit. Edge cases found only
  by reading code get flagged, not ticketed — security holes and billing
  abuse are the exception.

## Development Workflow

- Feature work flows through Spec Kit: `/speckit-specify` →
  `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`, with `/speckit-analyze` for cross-artifact checks.
- Plugin version bumps follow AGENTS.md exactly: bump once per PR for new
  MCP tools or substantial shipped-skill changes; keep all three plugin
  manifests on the same version; run `pnpm sync-plugin-skills` after any
  shipped-skill change.
- PR descriptions use the `simple-issue-description` format; repository
  friction goes to `.agents/PAPERCUTS.md` via the `papercuts` skill, not into
  PR bodies.
- Changes to `AGENTS.md`, `.claude/CLAUDE.md`, `.agents/skills/**`,
  `.github/**`, and `docs/maintainers/review-guidelines.md` alter the review
  control plane and REQUIRE explicit maintainer review.
- Verified review findings that expose recurring, high-risk invariants are
  added to `docs/maintainers/review-guidelines.md`; one-off bugs and
  preferences are not promoted to permanent rules.

## Governance

- This constitution states the non-negotiables; `AGENTS.md` remains the
  operational guidance and fills gaps the constitution does not cover. On
  conflict, constitution wins.
- Amendments require: documented rationale, a semantic-version bump
  (MAJOR — principle removed or redefined; MINOR — principle or section
  added; PATCH — clarification with no semantic change), and a migration note
  in the Sync Impact Report when existing practice becomes non-compliant.
- Every PR review MUST check compliance with Core Principles I–V; complexity
  beyond the simplest working solution must be justified in the PR
  description, not in review.
- Compliance is re-verified when Core Principles change and before any
  release that alters persistence, provider boundaries, or billing seams.

**Version**: 1.0.0 | **Ratified**: 2026-10-21 | **Last Amended**: 2026-10-21
