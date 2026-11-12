# Research: Self-Hosted OAuth Sign-In

Date: 2026-11-03 · Spec: [spec.md](spec.md)

All Phase-0 unknowns below were resolved by reading the codebase (paths cited)
and the installed `better-auth@1.6.22`. No open questions remain.

## Amendment (2026-11-03, later same day): provider-agnostic OIDC

The maintainer redirected the design: not "Google + Yandex providers" but
**one operator-configured OpenID Connect provider** — any IdP, chosen at
deploy time. Supersedes the vendor-specific parts below:

- **D4 (superseded)** — no Yandex-specific adapter ships. The single
  provider rides better-auth `genericOAuth` in discovery mode:
  `discoveryUrl = <issuer>/.well-known/openid-configuration`, client pair
  from env, default scopes `openid profile email`. Pinned from the installed
  plugin source (dist/plugins/generic-oauth/index.mjs + routes.mjs):
  discovery supplies `authorization_endpoint`, `token_endpoint`, AND
  `userinfo_endpoint`; the default userinfo path decodes the id_token when
  present, else fetches userinfo with `Authorization: Bearer`; the callback
  itself rejects a sign-in with no subject id (`sub`/`id`) or no email.
  Only `mapProfileToUser` is custom (name fallbacks, verified-email default)
  — `src/server/lib/ssoSignIn.ts`.
- **D6 (superseded in part)** — no `signInProviders` server→client surface:
  with exactly one provider the sign-in page always renders one button
  ("Continue with SSO"); the surface and its /api/health field were removed.
- **D8 (env changed)** — the oauth preflight requires `BETTER_AUTH_URL`,
  `BETTER_AUTH_SECRET`, `OAUTH_SIGNIN_ISSUER` (https),
  `OAUTH_SIGNIN_CLIENT_ID`, `OAUTH_SIGNIN_CLIENT_SECRET`; scopes optional.
- **D3 (auth instance unchanged except providers)** — the oauth branch
  registers the genericOAuth plugin from `OAUTH_SIGNIN_*` env instead of a
  Google socialProviders entry; email/password stays disabled; API-key
  plugin stays on for session modes.
- **D7 (linking)** — unchanged in principle; with one IdP configured it
  matters only when the operator swaps providers (accounts key on the
  provider's subject id; same email under a new IdP links to the existing
  user via Better Auth's verified-email rule).

Reason for the pivot: hardcoding a vendor list is product surface the
maintainer must maintain; OIDC discovery makes every conformant IdP work
through the same three variables, which is both less code than the two-vendor
version (no per-vendor adapter, no provider surface) and more capable.

## D1. New `AUTH_MODE` value and its name

- **Decision**: Add `"oauth"` as a fourth value of `AUTH_MODES`
  (`src/lib/auth-mode.ts`), meaning "self-hosted instance authenticated by
  OAuth sign-in against the operator's own providers".
- **Rationale**: The three existing names describe who authenticates the
  request (`cloudflare_access` = an Access proxy, `local_noauth` = nobody,
  `hosted` = the vendor's deployment). `"oauth"` follows the same
  who-authenticates convention. Alternative `"selfhosted_oauth"` was rejected:
  every self-hosted mode could claim that prefix; the value would carry no
  extra information.
- **Alternatives considered**: reusing `hosted` with relaxed config (rejected —
  `hosted` drags Loops email, Turnstile, Autumn billing, analytics hooks, and
  the MCP platform-provider routing along; the modes would become
  indistinguishable conditionals); an allowlist of emails instead of OAuth
  (rejected — the spec scopes audience control to the provider's app
  settings).

## D2. Session resolution reuses the hosted path, generalized by predicate

- **Decision**: `resolveUserContextFromHeaders`
  (`src/middleware/ensure-user/resolve.ts`) gains a branch that routes
  `"oauth"` to the existing session resolver in `ensure-user/hosted.ts` —
  Better Auth session → user → per-user default organization → owner role.
  The `hasHostedAuthConfig()` gate inside `requireHostedSession` becomes a
  mode-aware config check (hosted keeps Loops/Turnstile requirements; `oauth`
  requires only `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and at least one
  provider client pair). A small `isSessionAuthMode(mode)` helper
  (`hosted || oauth`) marks the shared seams; `isHostedAuthMode` keeps
  marking hosted-only features unchanged.
- **Rationale**: `resolveHostedContext` already implements exactly the spec's
  workspace-per-user semantics (its session-create hook mints a default org,
  re-resolves stale memberships, and stamps the role). The delegated path
  (`ensure-user/delegated.ts`) confirms the single-`user`-table invariant all
  modes rely on. Renaming `hosted.ts` internals is churn; the predicate keeps
  the seam explicit.
- **Alternatives considered**: a new resolver module for the mode (rejected —
  a third copy of session→org resolution would drift); treating the mode as
  hosted everywhere (rejected — see D1).

## D3. Auth instance: real baseURL, OAuth-only, provider clients optional

- **Decision**: In `createAuth()` (`src/lib/auth.ts`), the `oauth` mode:
  - builds with the real `BETTER_AUTH_URL` (same rule as hosted; required);
  - keeps `BETTER_AUTH_SECRET` required (unchanged);
  - overrides `emailAndPassword.enabled` to `false` (the base default in
    `src/lib/auth-options.ts` is `true` — leaving it on would expose password
    sign-up whose reset/verification callbacks are Loops-hosted and would
    fail at runtime);
  - omits `emailVerification` (no email infrastructure in scope);
  - builds `socialProviders` from whichever clients are configured: Google
    from `GOOGLE_CLIENT_ID/SECRET` (no throw when absent — Yandex-only
    deployments are valid), Yandex from `YANDEX_OAUTH_CLIENT_ID/SECRET`;
  - keeps the organization plugin and its defensive hooks from
    `createBaseAuthConfig` (the invite/role guards are cheap, already written,
    and the raw `/api/auth/organization/*` endpoints exist in every mode);
  - enables the API-key plugin (see D5) and skips captcha, disposable-email,
    analytics, and Loops contact-sync behaviors (all already guarded by
    `isHostedAuthMode`).
- **Rationale**: every hosted-only behavior in `createAuth` is already behind
  an `isHostedAuthMode` check, so the new mode mostly needs the `socialProviders`
  branch and the email/password override — not a parallel auth factory.
- **Alternatives considered**: allowing email/password without verification
  (rejected — spec says OAuth-only; passwords on a private instance add a
  brute-force surface for zero benefit); building a separate `createOAuthAuth`
  (rejected — duplicate of `createAuth` with three diffs).

## D4. Yandex sign-in rides Better Auth's `genericOAuth` plugin

- **Decision**: Register Yandex through `better-auth`'s installed
  `plugins/generic-oauth` (`better-auth@1.6.22` has no built-in Yandex
  provider — verified against `node_modules/better-auth/dist`). Fixed
  endpoints: authorize `https://oauth.yandex.ru/authorize`, token
  `https://oauth.yandex.ru/token`, userinfo `https://login.yandex.ru/info`
  (adapter normalizes the Yandex profile — id, login, `default_email`, name —
  at the boundary; Constitution IV in spirit). No extra scopes are requested
  beyond what `login.yandex.ru/info` needs; exact scope set and the PKCE
  requirements are pinned from current Yandex docs during implementation, the
  same way `yandexOAuth.ts` pinned Webmaster facts.
- **Rationale**: The repo already separates "sign-in identity" from "data
  grant" for Yandex (`yandexOAuth.ts` stores the Webmaster grant outside
  Better Auth's account-linking semantics precisely because data grants must
  be shareable across users). Sign-in is the opposite case — it is exactly
  what Better Auth's provider model is for, so the built-in machinery (state,
  PKCE, account table, linking) is reused rather than hand-rolled a third
  time. Callback path (`/api/auth/yandex/callback`) and the client
  registration steps go into the self-hosting docs.
- **Alternatives considered**: hand-rolled Yandex login flow mirroring
  `yandexOAuth.ts` (rejected — that module's reason to exist, reusable
  multi-user data grants, does not apply to sign-in); supporting GitHub too
  (rejected — no existing client in self-host config; spec names Google and
  Yandex).

## D5. MCP access in the new mode: API keys (session fallback), not the hosted OAuth provider

- **Decision**: Do NOT route the new mode through `openSeoOAuthProvider`
  (`src/server/mcp/oauth-provider.ts`): it requires the platform bindings
  `OAUTH_KV` and `OAUTH_PROVIDER` (`OpenSeoOAuthEnv`), which exist only on
  the hosted Workers deployment — the Docker runtime serves through the
  Node/vite path. Instead:
  - `handleSelfHostedOpenSeoMcpRequest` (`src/server/mcp/transport.ts`)
    accepts `"oauth"`, resolving a Bearer API key first, then a browser
    session, else `401` with `WWW-Authenticate`.
  - The API-key plugin (`createApiKeyPlugin`, today hosted-only in
    `createAuth`) is enabled for both session modes; the API-key settings UI
    gate widens from `isHostedClientAuthMode` to the session-mode predicate.
- **Rationale**: OpenSEO is MCP-first; a mode that bricks MCP clients
  protects the dashboard and kills the product's main interface. API keys are
  the existing, tested bearer mechanism (`api-key-auth.ts`), and its org
  resolution (`resolveExistingActiveHostedOrganization`) works for any user
  with an organization — which `oauth`-mode users have (D2). Anonymous
  requests still fail closed (spec FR-006).
- **Alternatives considered**: session-cookie-only `/mcp` (rejected — CLI/IDE
  MCP clients cannot do cookie flows; they would be locked out with no
  workaround); enabling the full workers OAuth provider in Docker (rejected —
  platform bindings unavailable outside Cloudflare Workers).

## D6. Client gating: a session-mode predicate, hosted UI stays hosted

- **Decision**: Client routing keys off one new predicate:
  `isSessionClientAuthMode()` = build-time `AUTH_MODE` is `hosted` or
  `oauth` (`src/lib/auth-mode.ts`, sibling of `isHostedClientAuthMode`).
  `useHostedAuthRouteGuard` and `useAuthPageState` gate sign-in behavior on
  it; billing banners, org settings, GSC re-engagement modal, sign-up page,
  hosted Terms clickwrap, and `AuthErrorCard` hosted copy stay on
  `isHostedClientAuthMode` (`_authenticated.tsx`, `_app/route.tsx`,
  `_auth.sign-in.tsx`). The sign-in page renders one button per provider the
  server reports as configured (surfaced through the existing server→client
  setup/status channel, `src/server/lib/setup-status.ts`); the email form and
  "Create account" link are hidden in `oauth` mode.
- **Rationale**: The guard's contract is "does this deployment need a
  sign-in gate" — that is now true for two modes. Everything else keyed to
  `isHostedClientAuthMode` encodes "is this the vendor's SaaS", which stays
  binary. The build-time/runtime alignment contract documented on
  `isHostedClientAuthMode` extends unchanged.
- **Alternatives considered**: making `isHostedClientAuthMode` return true for
  `oauth` (rejected — every hosted-only surface would appear on self-hosted
  instances; FR-010 forbids exactly that); runtime mode fetch before render
  (rejected — the repo explicitly accepted the build-time contract to avoid a
  startup round-trip).

## D7. Account linking across providers

- **Decision**: A Google sign-in and a Yandex sign-in with the same verified
  email address resolve to the same user (Better Auth's verified-email
  linking; `allowDifferentEmails: true` already set in `auth-config.ts`).
  Distinct emails mean distinct users with distinct workspaces. The Yandex
  adapter must mark the provider email verified (Yandex returns verified
  addresses for `default_email`) so linking behaves identically to Google.
- **Rationale**: One predictable rule, no divergent workspaces for one human
  (spec edge case), and it is the platform default rather than new policy
  code.
- **Alternatives considered**: never link, provider = identity (rejected —
  one human two workspaces; also requires disabling Better Auth's default
  linking, i.e. more code, not less).

## D8. Operator-facing configuration surface and fail-closed checks

- **Decision**: `src/lib/selfhost-preflight.ts` gains an `oauth` branch:
  requires `BETTER_AUTH_URL` (https or localhost, same rule as hosted),
  `BETTER_AUTH_SECRET` (≥32 chars), and at least one of the two client pairs
  (`GOOGLE_CLIENT_ID/SECRET`, `YANDEX_OAUTH_CLIENT_ID/SECRET`); the failure
  message names exactly the missing values (FR-008). The existing
  `cloudflare_access` failure hint gains the `oauth` alternative alongside
  `local_noauth`. `deploy/.env.selfhost.example`, `docs/SELF_HOSTING_DOCKER.md`,
  and `docs/SELF_HOSTING_CLOUDFLARE.md` document the mode, the extra redirect
  URIs operators must add to their OAuth apps
  (`/api/auth/callback/google`, `/api/auth/yandex/callback`), and the
  audience-restriction guidance (e.g. Google "internal" app type).
- **Rationale**: The preflight is the deployment's single fail-closed gate
  (constitution II) and already owns AUTH_MODE validation; adding the branch
  there keeps "misconfigured auth" reporting in one place.
- **Alternatives considered**: startup-time throw in `createAuth` only
  (rejected — preflight is what the Docker entrypoint and the self-host
  checklist actually surface; also the spec's anonymous-visitor guarantee is
  enforced by the resolver regardless).

## Facts pinned from the codebase

| Fact | Source |
| --- | --- |
| `AUTH_MODES = ["cloudflare_access","local_noauth","hosted"]`; unset fails closed to `cloudflare_access` | `src/lib/auth-mode.ts` |
| Self-hosted auth instance uses placeholder baseURL; social providers empty off-hosted | `src/lib/auth.ts` |
| `baseAuthOptions.emailAndPassword.enabled === true` by default | `src/lib/auth-options.ts` |
| Delegated and hosted modes share Better Auth's `user` table | `src/middleware/ensure-user/delegated.ts` |
| `resolveHostedContext` = session → user → default org → role | `src/middleware/ensure-user/hosted.ts` |
| Client sign-in gate is build-time `AUTH_MODE === "hosted"` | `src/client/features/auth/useHostedAuthRouteGuard.ts` |
| MCP hosted provider needs `OAUTH_KV` + `OAUTH_PROVIDER` bindings | `src/server/mcp/oauth-provider.ts` |
| Self-hosted MCP transport is a two-mode union today | `src/server/mcp/transport.ts` |
| better-auth 1.6.22: no Yandex social provider; `generic-oauth` plugin ships | `node_modules/better-auth/dist` |
| No DB schema changes needed; Better Auth tables already dual-dialect | `src/db/*` |
