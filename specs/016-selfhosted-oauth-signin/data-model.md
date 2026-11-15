# Data Model: Self-Hosted OAuth Sign-In

Date: 2026-11-03 · Spec: [spec.md](spec.md) · Research: [research.md](research.md)

## Zero new tables

The feature introduces **no schema changes**. It populates the existing
Better Auth tables — the same ones `cloudflare_access` and `local_noauth`
already write into (`src/middleware/ensure-user/delegated.ts` keeps a single
`user` table across all modes) — and the existing organization machinery
mints one workspace per user. Dual-dialect migrations (Constitution III) are
trivially satisfied: there is nothing to migrate.

## Entities and how the mode fills them

### Auth mode (deployment config, not a table)

| Field | Values | Notes |
| --- | --- | --- |
| `AUTH_MODE` | `cloudflare_access` (default) · `local_noauth` · `hosted` · **`oauth` (new)** | Validated by the Zod enum in `src/lib/auth-mode.ts`; a set-but-invalid value warns and fails closed to `cloudflare_access`. |
| Required when `oauth` | `BETTER_AUTH_URL` · `BETTER_AUTH_SECRET` · `OAUTH_SIGNIN_ISSUER` · `OAUTH_SIGNIN_CLIENT_ID/SECRET` (`OAUTH_SIGNIN_SCOPES` optional) | Enforced by `selfhost-preflight`; anonymous visitors never see data while misconfigured. |

Derived predicates (new, in `auth-mode.ts`):

- `isSessionAuthMode(mode)` — server: `hosted || oauth`. Marks seams shared by
  deployments with real Better Auth sessions (user resolution, API-key
  plugin).
- `isSessionClientAuthMode()` — client build-time mirror for the sign-in
  gate. `isHostedAuthMode` / `isHostedClientAuthMode` keep their exact
  current meaning (vendor SaaS features).

### User (`user` table — unchanged shape)

- Created automatically on first OIDC sign-in (provider identity → email,
  display name with `preferred_username`/`username`/`login` fallbacks,
  `emailVerified: true` — the operator chose the IdP, its identity is the
  account source).
- No `local_noauth` synthetic row is touched by the mode switch; the
  `local-admin` user and its data persist untouched.

### OAuth account (`account` table — unchanged shape)

- One row per (user, provider) sign-in link: `providerId` `sso` (the
  operator's single OIDC provider, `src/server/lib/ssoSignIn.ts`),
  `accountId` = the IdP's stable subject id (`sub`).
- Linking rule: same verified email → same user (existing
  `allowDifferentEmails` account-linking config, research D7) — matters when
  the operator swaps IdPs.
- Distinct rows from the *data-grant* flows (`yandex-webmaster`, GSC/GA4
  grants) — different lifecycle, different writers; no interaction.

### Session (`session` table — unchanged shape)

- Minted by Better Auth on OAuth sign-in; cookie-backed; sign-out deletes it.
- Session-create hook keeps minting/re-pointing the user's default
  organization exactly as today (research D2).

### Workspace (organization tables — unchanged shape)

- One per user, owner role, created by the existing session-create hook.
- Isolation: unchanged per-org scoping in services/repositories; the mode
  adds users, not sharing.

## Validation rules (trust boundaries)

| Boundary | Rule |
| --- | --- |
| `AUTH_MODE` value | Zod enum (`auth-mode.ts`); invalid → warn + fail closed. |
| IdP profile fields | Zod schema narrows the fields `mapProfileToUser` reads (name/username alternates, `email_verified`) — Constitution II; the plugin itself rejects profiles without `sub` or email. |
| Preflight env | presence + shape (`BETTER_AUTH_URL` https-or-localhost, `OAUTH_SIGNIN_ISSUER` https, secret ≥ 32 chars) with named-missing-value errors. |
| MCP bearer token | Existing API-key verification path; anonymous → 401 `WWW-Authenticate`. |

## State transitions

- **Anonymous → signed in**: provider consent → callback → (new user + org +
  session) | (existing user + session) → dashboard.
- **Signed in → signed out**: session deleted; next request re-enters
  anonymous.
- **`local_noauth` → `oauth` (operator action)**: rows untouched; the
  synthetic user remains in the DB; adopting its data is documented guidance
  (spec Assumption), not automation.
