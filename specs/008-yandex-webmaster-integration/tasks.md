---
description: "Task list for the Yandex Webmaster integration feature"
---

# Tasks: Yandex Webmaster Integration

**Input**: Design documents from `/specs/008-yandex-webmaster-integration/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included where the feature spec demands enforced behavior (Zod boundary normalization, honest empty states, reconnect semantics) — per AGENTS.md testing rules, at public entry points with only the HTTP boundary mocked.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Web app at repository root: `src/server/`, `src/client/`, `src/shared/`, `src/db/`, `docs/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared constants, schema, and adapters every story builds on.

- [x] T001 Add shared constants (provider id `yandex-webmaster`, scopes `webmaster:hostinfo,webmaster:verify`, self-host docs URL) in `src/shared/yandex-webmaster.ts`
- [x] T002 [P] Add `yandex_connections` sqlite table in `src/db/yandex.schema.ts` and pg table in `src/db/pg/yandex.schema.ts`; re-export both from `src/db/schema.ts` / `src/db/pg/schema.ts`
- [x] T003 Run `pnpm db:generate` and commit migrations for BOTH dialects (drizzle/sqlite + drizzle/pg)
- [x] T004 [P] Add error classes (api error with Yandex `error_code`, token error, not-connected error) in `src/server/lib/yandexWebmasterErrors.ts`
- [x] T005 Add the Zod-validated API adapter (uid, hosts, host info, summary, popular queries; `Authorization: OAuth` header; wire→camelCase normalization; comma-millisecond date handling) in `src/server/lib/yandexWebmasterClient.ts`
- [x] T006 [P] Add adapter tests with documented fixtures marked AT INTEGRATION in `src/server/lib/yandexWebmasterClient.test.ts`
- [x] T007 [P] Widen the OAuth state/PKCE helpers' provider type so the Yandex flow can reuse them (single-use nonce stays in the Better Auth verification table) in `src/server/features/google/googleOAuthState.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: OAuth flow + connection persistence that every story depends on.

- [x] T008 Implement the Yandex OAuth flow (authorize URL with PKCE + comma-joined scopes, code→token exchange, uid lookup as account id, grant upsert with encrypted tokens, callback handler, lazy refresh that persists Yandex's rotated refresh token, revoke) in `src/server/features/yandex/yandexOAuth.ts`
- [x] T009 Add the OAuth callback route `src/routes/api/yandex/oauth/callback.ts`
- [x] T010 [P] Implement `YandexConnectionRepository` (getByProjectId, upsert on project, deleteByProjectId) in `src/server/features/yandex/repositories/YandexConnectionRepository.ts`
- [x] T011 Implement `YandexWebmasterService` (getConnection, userHasGrant, listSitesForUser with reconnect status, setSite — re-lists and rejects unverified/foreign hosts, disconnect with grant cleanup when unused, getSearchPerformance — popular queries (≤2 serial pages) + summary + host info) in `src/server/features/yandex/services/YandexWebmasterService.ts`
- [x] T012 Add server functions (connection, list sites, set site, disconnect, start link, search performance) in `src/serverFunctions/yandexWebmaster.ts`
- [x] T013 [P] Add OAuth flow tests (state binding, scope-not-granted, refresh-token rotation, dead refresh ⇒ reconnect error) in `src/server/features/yandex/yandexOAuth.test.ts`

**Checkpoint**: connect → pick site → disconnect works end to end via server functions; foundation for UI and MCP.

---

## Phase 3: User Story 1 - Connect a Yandex Webmaster site (Priority: P1) 🎯 MVP

**Goal**: A user can link a Yandex account, pick one verified site for a project, and manage/disconnect it.

**Independent Test**: Integrations page card goes Not connected → picker → Connected (host shown) → Not connected again.

### Implementation for User Story 1

- [x] T014 [P] [US1] Build the connect card (setup-required state naming YANDEX_OAUTH_* envs, connect button → consent redirect with resume, site picker listing verified sites, connected state with change/disconnect, error param surfacing) in `src/client/features/integrations/YandexConnectionCard.tsx`
- [x] T015 [US1] Render the card on the integrations page in `src/routes/_app/p/$projectId/settings/integrations.tsx`

**Checkpoint**: US1 fully functional and testable independently.

---

## Phase 4: User Story 2 - Yandex tab on Search Performance (Priority: P2)

**Goal**: The Search Performance page gains a Yandex tab with the site summary and the popular-queries table for a chosen period/device.

**Independent Test**: With a connected site, the tab shows summary + queries; without, it shows the connect state; empty data renders an honest explanation.

### Implementation for User Story 2

- [x] T016 [US2] Add the `yandex` tab value to `src/types/schemas/search-performance.ts` (SEARCH_PERFORMANCE_TABS)
- [x] T017 [US2] Build the tab content (summary panel: SQI, pages in search, excluded, problems, indexing status; queries table: query/impressions/clicks/CTR/positions; period + device selects; reported-window caption; empty/disconnected/error states) in `src/client/features/search-performance/YandexSection.tsx`
- [x] T018 [US2] Wire the tab into the page in `src/client/features/search-performance/SearchPerformancePage.tsx` (Yandex content renders even when GSC is not connected)

**Checkpoint**: US1 + US2 independently usable.

---

## Phase 5: User Story 3 - Agent reads Yandex data (Priority: P3)

**Goal**: One read-only MCP tool returns popular queries + summary with honest limitations.

**Independent Test**: Tool call against a connected project returns rows + summary; unconnected returns `not_connected` + connectUrl.

### Implementation for User Story 3

- [x] T019 [P] [US3] Add the output contract `yandexWebmasterSchema` in `src/shared/mcp-contracts.ts`
- [x] T020 [US3] Implement `get_yandex_search_performance` (setup gate, input validation incl. both-or-neither dates, window clamp 4 days, rows by orderBy, limitations text) in `src/server/mcp/tools/yandex-webmaster-tools.ts`
- [x] T021 [US3] Register the tool in `src/server/mcp/server.ts`
- [x] T022 [P] [US3] Add tool tests (happy path table+summary, not connected, oauth not configured) in `src/server/mcp/tools/yandex-webmaster-tools.test.ts`

---

## Phase 6: User Story 4 - Self-hosted enablement (Priority: P4)

**Goal**: Operators can configure and verify the integration; docs explain app registration and scope caveats.

**Independent Test**: Preflight lists configured/partial/missing states; docs walk an operator through setup.

### Implementation for User Story 4

- [x] T023 [P] [US4] Add the "Yandex Webmaster (OAuth)" optional-feature check in `src/lib/selfhost-preflight.ts` (+ `src/server/lib/setup-status.ts` shares the same checks — verify no drift) and extend `src/lib/selfhost-preflight.test.ts`
- [x] T024 [P] [US4] Add `YANDEX_OAUTH_CLIENT_ID`/`YANDEX_OAUTH_CLIENT_SECRET` to `.env.example`, `compose.yaml` (environment block by the GOOGLE_CLIENT_* pattern), and `deploy/.env.selfhost.example`, each noted as separate from `YANDEX_SEARCH_API_KEY`
- [x] T025 [P] [US4] Write the operator guide (app registration, web-services app type, redirect URI, both scopes with the no-read-only caveat, env vars, Docker/Cloudflare specifics) in `docs/SELF_HOSTING_YANDEX_WEBMASTER.md`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T026 Bump the OpenSEO plugin version 1.0.23 → 1.0.24 in `plugins/openseo/.claude-plugin/plugin.json`, `plugins/openseo/.codex-plugin/plugin.json`, `plugins/openseo/.cursor-plugin/plugin.json` (new MCP tool ⇒ bump per AGENTS.md), then run `pnpm sync-plugin-skills`
- [x] T027 Run quickstart.md unit checks; fix fallout
- [x] T028 Verify gates: `pnpm exec tsc --noEmit`, `pnpm exec oxlint src --type-aware`, `pnpm exec prettier --check` on changed files, `pnpm exec knip`, `pnpm exec vitest run` (known Windows googleOAuth* EBUSY flake ignored)

### Deliberately deferred (out of v1; verified against research.md)

- Recrawl submission (`POST .../recrawl/queue`) — write operation, T025's docs mention it as future work.
- Indexing history (`/indexing/history`) and pages-in-search history — summary + host_data_status cover v1 needs.
- Query-analytics monitoring endpoint, per-URL query export, SQI history, sitemap management, important-URLs monitoring.
- Proactive grant-renewal sweep — v1 refreshes lazily; a grant unused through the final day of its validity asks for reconnect (documented in `yandexOAuth.ts`).
- Yandex account-removal UI parity with `googleAccounts.ts`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; T002→T003 sequential, T001/T004/T006/T007 parallel.
- **Foundational (Phase 2)**: depends on Phase 1; T008 needs T007, T011 needs T005+T010.
- **US1 (Phase 3)**: needs T012 (server functions) + T014/T015.
- **US2 (Phase 4)**: needs US1's connection + T012's data function.
- **US3 (Phase 5)**: needs T011 (service); independent of UI phases.
- **US4 (Phase 6)**: independent of US1–US3 (config/docs only); can run in parallel from Phase 1 onward.
- **Polish (Phase 7)**: last.

### Parallel Opportunities

- T001, T004, T006, T007 (Phase 1); T009, T010, T013 (Phase 2); T014 vs Phase 5/6 work; T019 vs T020; T023, T024, T025 (Phase 6).

## Implementation Strategy

MVP = Phases 1–3 (connect + manage). US2 and US3 each add an independently shippable surface. US4 is documentation/config that unblocks self-hosters at any point.

## Notes

- All Yandex API response fixtures in tests must embed documented examples (research.md §2) and carry an `AT INTEGRATION` marker for live re-verification when keys exist.
- Do not mix `YANDEX_SEARCH_API_KEY` (rank-tracking provider credential) into any Webmaster code path.

## Follow-up (2026-10-26): panel keyword discovery

- New server function `getPanelKeywordSuggestions` (serverFunctions/rank-tracking.ts → `PanelKeywordSuggestions` service) merges last-28-days queries from the project's connected GSC property and Yandex Webmaster site, subtracts keywords already tracked by the project's active trackers, and returns the top 50 by impressions plus the list of connected sources.
- The rank-tracking keyword suggestion step now shows these panel queries ("From your connected panels") alongside — or, for Labs-unserved markets like Russia, instead of — DataForSeo Labs suggestions, with per-row Google/Yandex source badges, shows/clicks metrics, and a connect hint linking to Integrations when no panel is connected.
