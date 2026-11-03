# Implementation Plan: Yandex Webmaster Integration

**Branch**: `008-yandex-webmaster-integration` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-yandex-webmaster-integration/spec.md`

## Summary

Add a Yandex Webmaster data source modeled on the existing Google Search Console integration: a Yandex ID OAuth grant per user (encrypted like Google grants), one Yandex site connected per project (`yandex_connections`, both dialects), popular search queries and a site summary rendered in a new Yandex tab on the Search Performance page, and a read-only MCP tool. The Yandex Webmaster API adapter normalizes Yandex wire types (`TOTAL_SHOWS`, `host_id`, `ApiQueryIndicator`) at the boundary per Constitution IV; all responses are Zod-validated; empty states and error reasons are honest about what Yandex does not report. Self-host config is a separate env pair (`YANDEX_OAUTH_CLIENT_ID`/`YANDEX_OAUTH_CLIENT_SECRET`) distinct from the existing `YANDEX_SEARCH_API_KEY` rank-tracking credential.

## Technical Context

**Language/Version**: TypeScript (strict), TanStack Start on Cloudflare Workers + Docker Node.

**Primary Dependencies**: TanStack Start server functions, TanStack Query/Router, Drizzle (sqlite + pg schemas), Zod, Better Auth (`account` table + token crypto), existing MCP server framework.

**Storage**: Better Auth `account` rows for encrypted grants (providerId `yandex-webmaster`); new `yandex_connections` table in both dialects with migrations.

**Testing**: Vitest; static imports, mock only the HTTP boundary (`fetch`), fixtures copied from Yandex docs and flagged `AT INTEGRATION` for live verification.

**Target Platform**: Cloudflare Workers (hosted + self-host) and Docker self-host.

**Project Type**: web application (full-stack feature slice).

**Performance Goals**: Popular-queries fetch ≤ 2 serial API pages per view (≤ 500 rows each); everything else single calls.

**Constraints**: Yandex caps the popular-queries pool at 3,000 queries with 500 rows per request; queries data finalizes ~4 days late; refresh tokens die together with access tokens.

**Scale/Scope**: 1 new table, 1 OAuth flow, 2 server features, 1 UI tab, 1 MCP tool (new tool ⇒ plugin patch bump per AGENTS.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Simplicity Over Abstraction** — PASS. The Yandex flow is a sibling of the Google flow, not a generalized "OAuth provider" framework: `yandexOAuth.ts` mirrors `googleOAuth.ts` with Yandex's differences (uid lookup instead of id_token, refresh-token rotation, `Authorization: OAuth` header). No new abstraction with one implementation is introduced beyond what the GSC pattern already established (repository + service + client adapter).
- **II. Verified Trust Boundaries** — PASS. Every Yandex API response is parsed with Zod in the client adapter; MCP tool input uses the shared Zod schema family; all queries are tenant-scoped through `requireProjectContext` / `withMcpProjectAuth` and repository `projectId` filters. OAuth state is single-use (reuses the verification-table nonce pattern).
- **III. Dual-Dialect Persistence** — PASS. `yandex_connections` defined in `src/db/yandex.schema.ts` and `src/db/pg/yandex.schema.ts` with identical columns; migrations generated for both via `pnpm db:generate`; schema-parity test covers the new table.
- **IV. Provider Normalization at the Boundary** — PASS. `yandexWebmasterClient.ts` is the only module that knows `TOTAL_SHOWS`, `host_id`, or Yandex's comma-millisecond dates; it returns camelCase internal types (`impressions`, `clicks`, `avgShowPosition`). Feature services and MCP tools never see vendor field names.
- **V. Tests Enforce Real Behavior** — PASS. Tests hit the service/tool entry points with `fetch` mocked at the HTTP boundary; fixtures come from Yandex's documentation examples; one test per invariant.

## Project Structure

### Documentation (this feature)

```text
specs/008-yandex-webmaster-integration/
├── plan.md              # This file
├── research.md          # Verified Yandex API facts with sources
├── data-model.md        # yandex_connections entity
├── quickstart.md        # Manual validation guide
├── contracts/           # MCP tool + server function contracts
│   └── mcp-yandex-webmaster.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── yandex-webmaster.ts            # provider id, scopes, docs URL, shared enums
│   └── mcp-contracts.ts               # + yandexWebmasterSchema
├── db/
│   ├── yandex.schema.ts               # sqlite yandex_connections
│   ├── pg/yandex.schema.ts            # pg yandex_connections
│   ├── schema.ts                      # re-export
│   └── pg/schema.ts                   # re-export
├── server/
│   ├── features/yandex/
│   │   ├── yandexOAuth.ts             # authorize URL, callback, token refresh, revoke
│   │   ├── services/YandexWebmasterService.ts
│   │   └── repositories/YandexConnectionRepository.ts
│   ├── lib/
│   │   ├── yandexWebmasterClient.ts   # Zod-validated API adapter (normalizes wire types)
│   │   └── yandexWebmasterErrors.ts
│   └── mcp/tools/yandex-webmaster-tools.ts
├── serverFunctions/yandexWebmaster.ts # connection + sites + link + data server fns
├── routes/api/yandex/oauth/callback.ts
├── routes/_app/p/$projectId/search-performance.tsx   # + yandex tab
├── client/features/
│   ├── search-performance/YandexSection.tsx          # tab content (summary + queries table)
│   └── integrations/YandexConnectionCard.tsx         # connect/pick/disconnect card
├── types/schemas/search-performance.ts               # + "yandex" tab value
└── lib/selfhost-preflight.ts                         # + Yandex Webmaster (OAuth) check
docs/SELF_HOSTING_YANDEX_WEBMASTER.md
.env.example / compose.yaml / deploy/.env.selfhost.example
plugins/openseo/.{claude,codex,cursor}-plugin/plugin.json  # 1.0.23 → 1.0.24
```

**Structure Decision**: Follows the established feature-slice layout (`features/<vendor>/services|repositories`, `lib/<vendor>Client.ts`, `serverFunctions/<feature>.ts`, `client/features/<feature>/`), exactly mirroring the GSC slice so the diff reads as "another provider," not a new architecture.

## Complexity Tracking

> No Constitution violations to justify.
