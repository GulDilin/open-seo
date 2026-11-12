# Contract: Operator configuration (`AUTH_MODE=oauth`)

The deployment-facing contract for the new mode. Research: [../research.md](../research.md) D1, D8 + amendment.

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `AUTH_MODE=oauth` | yes | Selects OpenID Connect sign-in as the deployment's authentication. |
| `BETTER_AUTH_URL` | yes | Public origin of the instance (https, or http on localhost). Backs cookies and OAuth callbacks. |
| `BETTER_AUTH_SECRET` | yes | ≥ 32 chars. Session signing + OAuth-token encryption. |
| `OAUTH_SIGNIN_ISSUER` | yes | The IdP's issuer base URL (https). Authorization, token, and userinfo endpoints are discovered from `<issuer>/.well-known/openid-configuration` at runtime. |
| `OAUTH_SIGNIN_CLIENT_ID` + `OAUTH_SIGNIN_CLIENT_SECRET` | yes | A client registered on the IdP. |
| `OAUTH_SIGNIN_SCOPES` | no | Space-separated scope override; default `openid profile email`. |

Rules:

1. Email/password sign-in does not exist in this mode; `emailAndPassword`
   is disabled server-side (research D3).
2. Exactly one provider is configured per deployment — the issuer named in
   the environment. Multi-provider setups are out of scope.
3. Build-time `AUTH_MODE` (client bundle) must equal runtime `AUTH_MODE`, the
   same alignment contract `hosted` already documents.

## Provider-side registration (operator-side, documented)

- Redirect URI: `<origin>/api/auth/oauth2/callback/sso`.
- The IdP must be OpenID Connect–conformant: a discovery document, and a
  userinfo (or id_token) carrying the subject id (`sub`) and the user's
  **email** — the email is the account key; a profile without one is a
  refused sign-in.
- Audience restriction is the operator's lever in the IdP's client policy;
  the instance itself admits every account the IdP releases.

## Preflight / failure behavior

- `selfhost-preflight` reports the mode with its missing-variable list (and
  rejects non-https issuers/origins) at the `AUTH_MODE` check item; the
  Docker entrypoint surfaces it as today.
- While misconfigured, every data request fails closed (no anonymous access,
  ever) — the resolver does not depend on the preflight having passed.
