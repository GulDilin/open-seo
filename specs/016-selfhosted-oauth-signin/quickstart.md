# Quickstart: Validate Self-Hosted OAuth Sign-In

Runnable end-to-end validation for the feature. Contracts:
[operator configuration](contracts/operator-configuration.md) ·
[sign-in and access](contracts/signin-and-access.md).

## Prerequisites

- A running local self-host instance (Docker path):
  `docker compose -f compose.yaml -f compose.local.yaml up -d --build`
- Any OpenID Connect provider you control — e.g. a Keycloak realm, an
  Authentik app, or a Google OAuth client (Google is an ordinary OIDC
  issuer: `https://accounts.google.com`). Register a client with redirect
  URI `http://localhost:3001/api/auth/oauth2/callback/sso`.
- An incognito browser (to prove anonymous behavior) and a normal one.

## 1. Flip the mode

In the deployment env (compose env / `.env`), set:

```
AUTH_MODE=oauth
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_SECRET=<64 random hex chars>
OAUTH_SIGNIN_ISSUER=https://<your-idp-issuer>
OAUTH_SIGNIN_CLIENT_ID=…
OAUTH_SIGNIN_CLIENT_SECRET=…
```

Recreate the container. Expected: the container starts, preflight reports the
auth check green (naming the issuer); the app loads.

## 2. Anonymous users see nothing (FR-001, FR-006, SC-002)

- Incognito: open `http://localhost:3001/` → redirected to `/sign-in`; a
  single "Continue with SSO" button renders (no email form, no "Create
  account").
- Incognito: `curl -i http://localhost:3001/api/health` stays available
  (unauthenticated health endpoint by design), while any data endpoint
  answers `401` — e.g. open the project list call the dashboard makes and
  confirm `UNAUTHENTICATED` in the incognito session-less case via the
  redirect-to-sign-in behavior in the browser.
- Incognito: `curl -i -X POST http://localhost:3001/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`
  → `401` with a `WWW-Authenticate` header.

## 3. First sign-in creates a workspace (FR-002/FR-004, SC-003)

- Normal browser: click "Continue with SSO" → consent at the IdP → land in
  the app. Timer: under a minute, ≤ 3 actions.
- Refresh: still signed in (session cookie).
- Sign out (user menu) → back to `/sign-in`; data endpoints now `401`/redirect
  again (FR-007).

## 4. Second human = second workspace (FR-005)

- Incognito: sign in with a second account admitted by the IdP → empty app
  (no first user's projects visible). Sign out.

## 4b. Any conformant IdP works (US-2, amended spec)

- Repeat step 1–3 with a different OIDC issuer (e.g. switch Keycloak →
  Google): only the three `OAUTH_SIGNIN_*` values change; sign-in works
  identically.

## 5. Misconfiguration fails closed, naming the variable (FR-008, US-3)

- Remove `OAUTH_SIGNIN_CLIENT_SECRET`, recreate → preflight/entrypoint error
  names `OAUTH_SIGNIN_CLIENT_SECRET`; the app serves **no** data to anyone
  (anonymous visitor still gets the sign-in/setup surface, never project
  data).
- Set `OAUTH_SIGNIN_ISSUER=http://…` (plain http) → preflight rejects it as
  "must be https".
- Set `AUTH_MODE` to a typo (`oauth2`) → warned, falls back to
  `cloudflare_access` (existing behavior, unchanged — FR-009 spot check).

## 6. MCP via API key (contract)

- Signed in, create an API key in settings; use it:
  `curl -i -X POST http://localhost:3001/mcp -H 'Authorization: Bearer <key>' …initialize…`
  → a normal JSON-RPC response (not 401). Repeat with a garbage key → 401.

## 7. Existing modes unregressed (FR-009, SC-004)

- `pnpm vitest run src/lib/selfhost-preflight.test.ts src/client` (mode
  dispatch suites) — plus the full check below.

## Full checks

```
pnpm lint && pnpm types:check && pnpm vitest run
```

Expected: green, including the existing auth-mode suites untouched.
