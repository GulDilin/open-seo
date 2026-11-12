# Feature Specification: Self-Hosted OAuth Sign-In

**Feature Branch**: `016-selfhosted-oauth-signin`

**Created**: 2026-11-03

**Status**: Draft

**Amended**: 2026-11-03 — provider-agnostic OpenID Connect. One
operator-configured IdP (any OIDC provider, endpoints discovered from its
`/.well-known/openid-configuration`) replaces the originally specified
Google + Yandex provider pair. Google remains usable as an ordinary OIDC
issuer.

**Input**: User description: "OAuth sign-in for self-hosted OpenSEO instances, so operators don't have to run AUTH_MODE=local_noauth wide open. Reuse the operator's own OAuth clients already supported in self-hosted config (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, YANDEX_OAUTH_CLIENT_ID/YANDEX_OAUTH_CLIENT_SECRET) to serve real user sessions via Better Auth social login instead of the no-auth local mode."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator protects an open self-hosted instance with their own IdP (Priority: P1)

A self-hoster runs OpenSEO in Docker with `AUTH_MODE=local_noauth` because the
alternative (Cloudflare Access) does not fit their setup. Their instance is
reachable beyond the loopback interface, so "no auth" means anyone who finds
the URL reads their search data. They switch the auth mode to OAuth sign-in
and configure it with an OpenID Connect provider of their choice (Keycloak,
Authentik, Google, Auth0, or their own IdP) by setting its issuer URL and
client credentials. After a restart, every visitor hits a sign-in screen; the
operator signs in with their IdP account, lands in their workspace, and
confirms the data is exactly what it was before the switch.

**Why this priority**: This is the whole point of the feature — the only
self-host auth option today that requires no third-party service in front of
the instance is "no auth at all". Everything else builds on this slice.

**Independent Test**: Can be fully tested by flipping one deployment from
`local_noauth` to the new mode with a configured OIDC issuer and client pair,
and verifying that an anonymous visitor sees no data while the operator's IdP
account gets in.

**Acceptance Scenarios**:

1. **Given** a self-hosted instance running with the new auth mode and a
   configured OpenID Connect provider, **When** an anonymous visitor opens
   any app page, **Then** they are shown the sign-in screen and see none of
   the instance's data.
2. **Given** the same instance, **When** the operator clicks the sign-in
   button and approves consent at their IdP, **Then** an account is created
   on first sign-in and they land in an empty personal workspace (or their
   existing one on repeat sign-in).
3. **Given** a signed-in user, **When** they sign out, **Then** their session
   ends and the app requires sign-in again before showing any data.
4. **Given** an anonymous request to a data API endpoint, **When** no session
   is present, **Then** the request is rejected with an authentication error
   (not a redirect), so programmatic callers get an unambiguous status.

---

### User Story 2 - Any OpenID Connect provider, no per-vendor setup (Priority: P2)

The operator already runs an identity provider (Keycloak, Authentik, their
company IdP) or prefers a different public one than anyone hardcoded. They
point the instance at its issuer URL and register a client there; the product
discovers the authorization, token, and userinfo endpoints from the
provider's OIDC discovery document — no per-vendor code or provider-specific
configuration exists in the product.

**Why this priority**: This is what makes the mode universally usable rather
than tied to a vendor list the maintainers picked; without it, the feature
only serves operators whose IdP happens to be supported.

**Independent Test**: Complete a sign-in against two different OIDC providers
(e.g. Keycloak and Google) using the same three configuration variables —
no product changes between them.

**Acceptance Scenarios**:

1. **Given** the new auth mode configured with provider A's issuer and
   client pair, **When** a user completes consent, **Then** they land in
   their workspace.
2. **Given** the same product switched to provider B's issuer and client
   pair (no code or other configuration change), **When** a user completes
   consent, **Then** sign-in works identically.

---

### User Story 3 - Misconfiguration fails closed with an actionable message (Priority: P3)

An operator sets the new auth mode but forgets one of the required OAuth
client values (or points the instance at an origin the OAuth client does not
allow). The instance must not silently fall back to open access or serve a
broken consent loop; it must tell the operator exactly which setting is
missing or wrong.

**Why this priority**: A half-configured auth mode is the state an operator
hits exactly once, mid-migration; if it fails silently the feature loses the
trust of its only audience on first contact.

**Independent Test**: Set the mode with each individual required value
missing and observe the failure message; each names the missing value and the
instance denies data access throughout.

**Acceptance Scenarios**:

1. **Given** the new auth mode with an incomplete OAuth client
   configuration, **When** the instance starts or serves a request,
   **Then** it refuses to serve app data and reports which configuration
   value is missing.
2. **Given** the new auth mode with no OAuth client configured at all,
   **When** a visitor opens the app, **Then** no data is served and the
   sign-in screen explains that the operator must finish setup — anonymous
   visitors never see data regardless of configuration state.

---

### Edge Cases

- What happens when a consent screen is abandoned or the OAuth callback
  arrives with an expired/stale state? The user lands on an error page with a
  retry path, never on a half-authenticated session.
- What happens when someone signs in with an account the operator did not
  mean to admit (e.g., a public IdP client lets anyone in)? The docs must
  state plainly that audience restriction is done in the IdP's client policy,
  because the instance itself accepts any account the IdP releases.
- What happens when the provider's profile carries no email address? The
  sign-in is refused with a clear cause — the email is the account key —
  rather than creating an account without one.
- What happens when the operator swaps the IdP later? Accounts created under
  the previous provider keep working through other auth paths (API keys,
  sessions); linking behavior must be defined and predictable.
- What happens when the instance is served from `localhost` or plain HTTP
  behind a private network? Sign-in must work there too — this mode exists
  precisely for private deployments.
- What happens to the synthetic user and data created under `local_noauth`
  when the operator switches to the new mode? The switch must not destroy
  data; whether/how it can be adopted is defined in the plan.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST offer a self-hosted auth mode in which access
  to every page and data endpoint requires a signed-in session obtained via
  OAuth with an operator-configured provider.
- **FR-002**: The mode MUST support ANY OpenID Connect provider configured
  by issuer URL and client credentials — no provider-specific code or
  per-vendor product configuration.
- **FR-003**: Authorization, token, and userinfo endpoints MUST be discovered
  from the provider's OIDC discovery document at runtime; the operator never
  pastes individual endpoint URLs.
- **FR-004**: First sign-in MUST create a user account automatically; repeat
  sign-ins MUST reuse the same account and its data.
- **FR-005**: Each signed-in user MUST get a personal workspace whose data is
  not visible to other signed-in users of the same instance.
- **FR-006**: Unauthenticated API requests MUST be rejected with an
  authentication error; unauthenticated page visits MUST be routed to the
  sign-in screen.
- **FR-007**: Users MUST be able to sign out, ending their session.
- **FR-008**: The instance MUST fail closed when the mode is enabled but its
  required configuration is incomplete, naming the missing configuration.
- **FR-009**: Existing auth modes (`local_noauth`, `cloudflare_access`,
  `hosted`) MUST keep their current behavior unchanged.
- **FR-010**: The sign-in experience MUST NOT surface hosted-only concepts
  (team invitations, billing screens, hosted marketing copy) to self-hosted
  users.
- **FR-011**: Self-hosting documentation MUST describe how to enable the
  mode, including provider app registration, audience restriction guidance,
  and switching from `local_noauth`.

### Key Entities *(include if feature involves data)*

- **Auth mode**: A deployment-level operator setting that selects how users
  are authenticated. This feature adds one mode alongside the existing three.
- **Sign-in provider**: An OAuth identity provider (Google, Yandex) whose
  client credentials the operator registers and configures on the instance.
- **User account**: A person with an identity from a sign-in provider;
  created on first sign-in, reused afterwards.
- **Session**: The signed-in state of a user; expires and can be ended by
  sign-out.
- **Workspace**: The per-user container of projects and SEO data; one per
  user, isolated from other users on the same instance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator following the documentation converts a running
  `local_noauth` instance into an OAuth-protected one in 15 minutes or less,
  adding no new accounts or services beyond the OAuth app registration they
  already have.
- **SC-002**: 100% of app pages and data endpoints reject anonymous access
  when the mode is enabled — verified by a sweep of routes in the anonymous
  state.
- **SC-003**: A first-time user completes sign-in (from opening the instance
  to landing in the workspace) in under 1 minute with at most three user
  actions.
- **SC-004**: All existing auth-mode behaviors pass their current tests
  unchanged (no regressions in `local_noauth`, `cloudflare_access`, or
  `hosted`).

## Assumptions

- The new mode is OAuth-only: no email/password sign-in, no email
  verification, and therefore no email-sending dependency for self-hosted
  operators.
- Exactly ONE sign-in provider is configured per deployment — the operator's
  OpenID Connect IdP of choice. Multiple simultaneous providers are out of
  scope (the configuration shape extends if ever needed).
- The IdP must be OpenID Connect–conformant: a discovery document, and a
  userinfo (or id_token) that includes the subject id and the user's email.
- Audience restriction (who may sign in) is deliberately the operator's
  lever in the IdP's client policy, not a per-instance allowlist; this is
  documented rather than built.
- Multiple people may hold accounts on one instance, but team/invitation
  mechanics are out of scope; every account is an ordinary isolated user.
- Migrating the synthetic `local_noauth` user's existing data into a named
  account is desirable but may ship as documented guidance rather than
  automated tooling, per the plan.
- Hosted deployments are unaffected: the mode is meaningful only for
  self-hosted Docker and self-hosted Cloudflare runtimes.
