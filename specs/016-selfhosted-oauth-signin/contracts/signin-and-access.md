# Contract: Sign-in surface and access control (`oauth` mode)

User- and client-facing behavior contracts. Research: [../research.md](../research.md) D2, D5, D6 (amendment), D7.

## Pages

| Route | `oauth`-mode behavior |
| --- | --- |
| `/sign-in` | Rendered for anonymous visitors; ONE button ("Continue with SSO") starting the flow with the operator's configured OIDC IdP. No email form, no "Create account" link, no hosted Terms clickwrap. |
| `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-email` | Not reachable (hosted-only surfaces; the mode has no email/password). |
| `/auth-error` | Shared error landing for failed OAuth handshakes (state mismatch, canceled consent, missing profile email). |
| `/_app/**` | Anonymous → redirected to `/sign-in` with `redirect` back-link; signed-in → normal app. Hosted-only banners/sections hidden (billing, hosted org UI). |

## Sign-in semantics

1. First sign-in with the IdP creates the account (email, display name —
   falling back to `preferred_username`/`username`/`login` when the IdP
   sends no `name` — `emailVerified: true`) plus a personal workspace; the
   user lands in the app. No separate sign-up step, no email round-trip.
2. Repeat sign-in reuses the same account and workspace.
3. A profile without a subject id (`sub`/`id`) or without an email is a
   refused sign-in with a visible error — never an account without an
   address.
4. Sign-out ends the session; the next request is anonymous.

## API access control (all non-MCP data endpoints)

| Caller state | Page route | Data endpoint (server function / raw API) |
| --- | --- | --- |
| Valid session | app renders | `200`, tenant-scoped to the user's workspace |
| No/expired session | `302` → `/sign-in?redirect=…` | `401` `UNAUTHENTICATED` JSON error (no redirect — programmatic callers get an unambiguous status) |

## MCP endpoint (`/mcp`)

| Credential | Result |
| --- | --- |
| `Authorization: Bearer openseo_…` API key (created in settings) | Served, scoped to the key's user/workspace. |
| Browser session cookie | Served (same scoping). |
| Neither | `401` with `WWW-Authenticate` (MCP clients are expected to use API keys). |

The hosted MCP OAuth flow (authorize/token endpoints) is **not** part of this
mode — it depends on Cloudflare platform bindings unavailable to Docker
self-host (research D5).

## Compatibility (unchanged surfaces)

- `local_noauth`, `cloudflare_access`, `hosted`: behavior identical to today.
- Data grants (GSC/GA4/Yandex Webmaster connect cards) keep working for
  signed-in `oauth`-mode users; their provider clients (`GOOGLE_CLIENT_*`,
  `YANDEX_OAUTH_*`) are unrelated to the sign-in provider and untouched.
