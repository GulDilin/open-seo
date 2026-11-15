---
description: "Task list for Self-Hosted OAuth Sign-In"
---

# Tasks: Self-Hosted OAuth Sign-In

**Input**: Design documents from `/specs/016-selfhosted-oauth-signin/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ ✔ all present

**Tests**: Included where the repo's testing rules (Constitution V) demand them — behavior tests at public entry points, beside their modules. Not blanket TDD.

**Organization**: Grouped by user story; each story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (Google sign-in, P1) · US2 (Yandex sign-in, P2) · US3 (fail-closed misconfig, P3)
- Paths are repository-root relative (single project, `src/…`).

---

## Phase 1: Setup (Research)

**Purpose**: Pin external facts before code, the repo's established pattern (`yandexOAuth.ts` header).

- [x] T001 Verify current Yandex sign-in facts from official docs (oauth.yandex.ru + login.yandex.ru/info): minimal scope for the userinfo call, whether PKCE is required for web flows, the exact userinfo JSON shape (`id`, `login`, `default_email`, `real_name`/name fields, verified semantics). Record the pinned facts in the header comment of the new `src/server/lib/yandexSignIn.ts` created in T014, with source URLs, matching the fact-pinning style of `src/server/features/yandex/yandexOAuth.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The mode's skeleton — enum, predicates, resolver branch, auth instance shape, provider surface, client gate. No story can start before this phase ends.

- [x] T002 Add `"oauth"` to `AUTH_MODES` and the Zod enum in `src/lib/auth-mode.ts`; add `isSessionAuthMode(mode)` (`hosted || oauth`) and `isSessionClientAuthMode()` (build-time mirror, same contract comment as `isHostedClientAuthMode`). Existing `isHostedAuthMode`/`isHostedClientAuthMode` semantics unchanged. Extend the mode-dispatch tests beside the module.
- [x] T003 Route `"oauth"` in `src/middleware/ensure-user/resolve.ts` to the session resolver in `src/middleware/ensure-user/hosted.ts`; replace the `hasHostedAuthConfig()` gate in `requireHostedSession` with a mode-aware check (hosted keeps its Loops/Turnstile requirements; `oauth` requires `BETTER_AUTH_URL` + `BETTER_AUTH_SECRET` only — provider pairs are checked by preflight, not per-request). Behavior test: `resolveUserContextFromHeaders` with `AUTH_MODE=oauth` and no session rejects `UNAUTHENTICATED` for the reason its name gives.
- [x] T004 Add the `oauth` branch to `createAuth()` in `src/lib/auth.ts` (research D3): real `BETTER_AUTH_URL` baseURL; `emailAndPassword.enabled: false` override; `emailVerification` omitted; `socialProviders` built from configured clients — Google from `GOOGLE_CLIENT_ID/SECRET` when the pair is complete (no throw when absent); no captcha/disposable-email/analytics paths (already `isHostedAuthMode`-gated); enable `createApiKeyPlugin()` for session modes (`isSessionAuthMode`), keep everything else hosted-only; Yandex wiring lands in T015.
- [x] T005 Expose the configured sign-in providers to the client through the existing server→client setup channel: extend `src/server/lib/setup-status.ts` (and the server function/client hook that already consumes it — trace with Grep) with a `signInProviders` list (`"google"` when its pair is complete; `"yandex`" added by T015). Contract: the sign-in page offers exactly these (contracts/operator-configuration.md rule 1).
- [x] T006 Switch the client sign-in gate to the session-mode predicate: `src/client/features/auth/useHostedAuthRouteGuard.ts` and `useAuthPageState` in `src/client/features/auth/AuthPage.tsx` gate sign-in redirects on `isSessionClientAuthMode()`; hosted-only surfaces (billing banners in `src/routes/_app/route.tsx`, `AuthErrorCard`, `GscReEngagementModal`, `/_authenticated/**` pages) keep using `isHostedClientAuthMode` untouched.

**Checkpoint**: `AUTH_MODE=oauth` redirects anonymous visitors to `/sign-in`; a session (if one existed) resolves. No provider buttons yet.

---

## Phase 3: User Story 1 - Operator protects the instance with Google sign-in (Priority: P1) 🎯 MVP

**Goal**: A correctly-configured Docker self-host flips from `local_noauth` to OAuth-protected with Google; anonymous access is dead; MCP works via API keys.

**Independent Test**: quickstart.md steps 1–3 and 6 (mode flip, anonymous lockout, first sign-in, MCP key) pass on a Google-only deployment.

- [x] T007 [P] [US1] Add the `oauth` branch to `src/lib/selfhost-preflight.ts`: requires `BETTER_AUTH_URL` (https-or-localhost), `BETTER_AUTH_SECRET` (≥32), ≥1 complete provider pair — satisfied by the Google pair here; report green with the mode label. Extend `src/lib/selfhost-preflight.test.ts` with the happy path (failure branches are US3).
- [x] T008 [US1] Rework `src/routes/_auth.sign-in.tsx` for the `oauth` mode: render "Continue with Google" driven by the T005 provider surface (reuse `useGoogleAuth`); hide the email form, "Create account" link, and hosted Terms clickwrap (`isHostedClientAuthMode`-gated); keep hosted behavior byte-identical.
- [x] T009 [US1] Extend `src/server/mcp/transport.ts`: `handleSelfHostedOpenSeoMcpRequest`'s `authMode` union gains `"oauth"`; the branch resolves a Bearer API key first (existing `src/server/mcp/api-key-auth.ts` path — widen its `getHostedBaseUrl`/hosted-org assumptions to session modes), then a browser session, else `401` with `WWW-Authenticate`. Extend `src/server/mcp/transport.test.ts` with the 401-anonymous and key-authenticated cases. Route the mode in `src/server.ts` (the self-hosted MCP branch condition gains `"oauth"`).
- [x] T010 [P] [US1] Widen the API-key management UI gate from `isHostedClientAuthMode` to `isSessionClientAuthMode` on the settings surface that creates/revokes MCP keys (locate via Grep for the API-key settings component under `src/routes/_app/settings/**` / `src/client/**`); hosted-only chrome around it stays hosted-only.
- [x] T011 [P] [US1] Update `deploy/.env.selfhost.example` (new `AUTH_MODE=oauth` block with both provider pairs commented) and `docs/SELF_HOSTING_DOCKER.md` (mode section: env vars, Google redirect URI `<origin>/api/auth/callback/google`, build-time/runtime `AUTH_MODE` alignment, audience restriction via Google "internal" app type, and the documented path for adopting `local-admin` data — guidance, not automation).
- [ ] T012 [US1] Validate US1 end-to-end per `specs/016-selfhosted-oauth-signin/quickstart.md` steps 1–3 and 6 on the Docker path; fix what falls out.

**Checkpoint**: MVP — a Google-configured self-host is protected and fully usable (app + MCP).

---

## Phase 4: User Story 2 - Sign-in with Yandex ID (Priority: P2)

**Goal**: Yandex works as the sole or second sign-in provider, same workspace semantics.

**Independent Test**: quickstart.md steps 1–3 pass on a Yandex-only deployment (no `GOOGLE_CLIENT_*` set); both buttons render when both pairs exist.

- [x] T013 [P] [US2] Create `src/server/lib/yandexSignIn.ts`: the Better Auth `genericOAuth` provider config for Yandex — pinned endpoints (`https://oauth.yandex.ru/authorize` / `/token`, userinfo `https://login.yandex.ru/info`), scope from T001, a Zod schema for the userinfo response narrowed at the boundary, `mapProfileToUser` mapping `id`/`default_email`/name with the provider email marked verified (linking rule, research D7). Tests beside the module: userinfo mapping and the verified-email invariant.
- [x] T014 [US2] Wire Yandex into auth: register the `genericOAuth` server plugin in `src/lib/auth.ts` when the Yandex pair is complete (alongside T004's provider building); add `genericOAuthClient` to `src/lib/auth-client.ts` so the client can start the flow.
- [x] T015 [P] [US2] Add `"yandex"` to the T005 `signInProviders` surface when its pair is complete.
- [x] T016 [P] [US2] Add the "Continue with Yandex" button variant (Yandex mark + label) to the chooser in `src/client/features/auth/AuthPage.tsx` and `src/routes/_auth.sign-in.tsx`, driven by the provider surface; Yandex-only deployments render it alone.
- [x] T017 [P] [US2] Document the Yandex path in `docs/SELF_HOSTING_DOCKER.md` (redirect URI `<origin>/api/auth/yandex/callback`, app registration, audience control) beside the Google section.
- [ ] T018 [US2] Validate US2 end-to-end per quickstart.md on a Yandex-only deployment; fix fallout.

**Checkpoint**: Stories 1 and 2 both work, independently and together.

---

## Phase 5: User Story 3 - Misconfiguration fails closed, naming the variable (Priority: P3)

**Goal**: Every half-configured state denies data to everyone and tells the operator exactly what is missing.

**Independent Test**: quickstart.md step 5 (and step 5's typo case) passes.

- [x] T019 [P] [US3] Failure branches in `src/lib/selfhost-preflight.test.ts` + `src/lib/selfhost-preflight.ts`: half pair (name the exact missing variable, e.g. `GOOGLE_CLIENT_ID` without `GOOGLE_CLIENT_SECRET`), no provider pair at all, short/missing `BETTER_AUTH_SECRET`, invalid `BETTER_AUTH_URL` scheme. One test per invariant, per the repo's testing rules.
- [x] T020 [P] [US3] Update the `cloudflare_access` failure hint in `src/lib/selfhost-preflight.ts` to offer `AUTH_MODE=oauth` alongside `local_noauth`, with its test adjusted.
- [x] T021 [US3] Verify (and test if not already covered by T003) that a misconfigured `oauth` deployment still fails closed per-request: the resolver never serves data without a session regardless of preflight state (spec US-3 scenario 2).

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T022 [P] Mirror the mode section for the Workers self-host path in `docs/SELF_HOSTING_CLOUDFLARE.md`; check whether `web/content/docs/` self-hosting pages mirror Docker/CF docs and update the public copies if they do.
- [x] T023 Run the full gate: `pnpm lint && pnpm typecheck && pnpm vitest run`; fix fallout.
- [ ] T024 Full `specs/016-selfhosted-oauth-signin/quickstart.md` pass (all steps incl. FR-009 spot checks) and record results in the PR description.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: no deps; blocks T013 only.
- **Phase 2 (T002–T006)**: sequential-ish (T003/T004 depend on T002; T005 independent; T006 depends on T002) — blocks ALL stories.
- **US1 (Phase 3)**: after Phase 2; T008 depends on T005+T006; T009/T010/T011 parallelize.
- **US2 (Phase 4)**: after Phase 2; T013 after T001; independent of US1 (T016 needs T005's surface from Phase 2, not US1's button).
- **US3 (Phase 5)**: after Phase 2 (T007's happy path); parallel with US1/US2.
- **Phase 6**: after all desired stories.

### User Story Dependencies

- **US1**: Phase 2 only. MVP boundary.
- **US2**: Phase 2 + T001. Integrates with US1 only at the shared sign-in page (independent buttons — no code dependency).
- **US3**: Phase 2. Tests the same preflight US1's T007 made green; failure branches are additive.

### Parallel Opportunities

- Phase 2: T005 ∥ (T002→T003→T004 chain, T006 after T002).
- US1: T007 ∥ T010 ∥ T011 while T008/T009 run.
- US2: T013 ∥ T015 ∥ T016 ∥ T017.
- US3: T019 ∥ T020 once T007's shape exists.

---

## Parallel Example: User Story 2

```bash
# Different files, no shared deps:
Task: T013 "Create src/server/lib/yandexSignIn.ts"
Task: T015 "Add yandex to signInProviders in src/server/lib/setup-status.ts"
Task: T017 "Yandex docs in docs/SELF_HOSTING_DOCKER.md"
# Then sequential: T014 (auth wiring) → T016 (button) → T018 (validate)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1–2 (skeleton; T001 skippable if US2 deferred)
2. Phase 3 → **STOP and VALIDATE** quickstart steps 1–3, 6
3. Deployable: a Google-configured protected instance

### Incremental Delivery

US1 → US2 (Yandex audience) → US3 (failure ergonomics) → Phase 6. Each story ships value alone; US3 is pure polish on the same seam.

---

## Phase 7: Amendment — provider-agnostic OpenID Connect (2026-11-03)

Maintainer pivot: one operator-configured OIDC IdP instead of hardcoded Google+Yandex. Supersedes the vendor-specific parts of T008/T013–T017 and the provider surface of T005; see research.md "Amendment".

- [x] T025 Create `src/server/lib/ssoSignIn.ts` (genericOAuth discovery mode: issuer → `/.well-known/openid-configuration`, client pair from env, `mapProfileToUser` name/verified-email gaps) + `src/shared/sso-signin.ts` (provider id, default scopes) + tests in `src/server/lib/ssoSignIn.test.ts`.
- [x] T026 Rewire `src/lib/auth.ts` (`getSsoSignInPlugin` from `OAUTH_SIGNIN_*`; `getSocialProviders` back to hosted-only) and `src/env.d.ts` (`OAUTH_SIGNIN_ISSUER/CLIENT_ID/CLIENT_SECRET/SCOPES`); delete `yandexSignIn.ts` + test + `useYandexSignIn.ts`.
- [x] T027 Simplify the client: single "Continue with SSO" button in `src/routes/_auth.sign-in.tsx` via `src/client/features/auth/useSsoSignIn.ts`; revert `AuthMethodChooser` to its pre-feature shape; drop the `signInProviders` surface from `src/server/lib/setup-status.ts` and `useSignInProviders`.
- [x] T028 Preflight (`src/lib/selfhost-preflight.ts` + tests): require `OAUTH_SIGNIN_ISSUER/CLIENT_ID/CLIENT_SECRET` (issuer https), scopes optional; remove the Google/Yandex pair logic.
- [x] T029 Docs and env examples rewritten for OIDC (`docs/SELF_HOSTING_DOCKER.md` + web mirror, CF pointers ×2, `.env.example`, `deploy/.env.selfhost.example`); spec/research/contracts/data-model/quickstart amended.

---

## Notes

- **No plugin version bump**: no MCP tools or shipped skills change (AGENTS.md rule).
- No DB migrations — zero schema changes (data-model.md).
- FR-010 guard: while touching client gates, `isHostedClientAuthMode` call sites must only ever *narrow* to `isSessionClientAuthMode` where the surface is genuinely session-related (sign-in, keys); billing/org/hosted chrome stays hosted.
- `pnpm sync-plugin-skills` not needed (no skill changes).
