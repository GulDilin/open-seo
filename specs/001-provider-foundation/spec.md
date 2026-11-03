# Feature Specification: Provider Foundation (Phase 0 of provider replacement)

**Feature Branch**: `001-provider-foundation`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Phase 0 of the DataForSeo provider replacement:
provider configuration env vars and the seo-providers skeleton. No behavior
change."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator sees which SEO data providers are configured (Priority: P1)

As a self-hosting operator, I can set optional credentials for alternative
SEO data providers (Serper, Yandex Search API, Bright Data) alongside the
existing DataForSeo key, and the setup/preflight screen shows each provider
as configured or not configured, so I know what data my instance can fetch
before relying on it.

**Why this priority**: Configuration visibility is the entire user-facing
value of this phase and is independently shippable; nothing else in the
migration can be verified without it.

**Independent Test**: Set none of the new variables — the app behaves exactly
as today. Set one variable — preflight shows that provider as configured,
others as not.

**Acceptance Scenarios**:

1. **Given** a deployment with only `DATAFORSEO_API_KEY` set, **When** the
   operator opens the self-host preflight/setup status, **Then** DataForSeo
   shows as configured and every alternative provider shows as not
   configured, with no errors.
2. **Given** a deployment with a Serper key set, **When** the operator opens
   the preflight, **Then** Serper shows as configured.
3. **Given** a provider variable set to an empty value, **When** preflight
   runs, **Then** that provider is treated as not configured (empty ≠ key).
4. **Given** any combination of provider variables, **When** preflight runs,
   **Then** secret values themselves are never displayed — only status.

---

### User Story 2 - Feature code can ask "which provider serves this search engine?" (Priority: P2)

As a developer (internal user of the foundation), I can query a single
shared source of truth for which search engines exist (Google, Yandex, Baidu,
Bing), which providers can serve each engine, and which of them is
configured, so that UI, server code, and MCP tool validation never disagree
about what is available.

**Why this priority**: The routing table is the seam every later phase plugs
into; shipping it now, unused, keeps later phases small.

**Independent Test**: A call to resolve a provider for an engine returns the
first configured provider in the priority chain, or a clear error naming the
missing configuration variable — testable without any feature using it.

**Acceptance Scenarios**:

1. **Given** the Google engine and a configured Serper key, **When** a
   provider is resolved, **Then** a Google-capable provider is returned.
2. **Given** the Yandex engine and no Yandex credentials, **When** a provider
   is resolved, **Then** the system reports that no provider serves Yandex
   and names the credential that is missing.
3. **Given** an engine a country does not support (e.g. Baidu for Norway),
   **When** availability is checked, **Then** it reports unavailable.
4. **Given** no new provider variables are set anywhere, **When** any
   existing feature runs, **Then** behavior is byte-for-byte identical to
   before this feature.

---

### Edge Cases

- What happens when a credential is whitespace-only? Treated as not
  configured.
- What happens when only Yandex credentials are set but DataForSeo is not?
  Preflight shows both statuses honestly; existing DataForSeo-dependent
  features report their existing "provider not configured" behavior. No
  feature is expected to work yet — this phase adds no data paths.
- What happens when the same engine has two providers configured? The fixed
  priority chain decides deterministically; the choice is visible in the
  routing table, not hidden in code.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept optional, independent credentials for
  Serper, Yandex Search API (key plus cloud folder identifier), and Bright
  Data, each absent by default.
- **FR-002**: The self-host preflight/setup status MUST show, per provider,
  whether it is configured, without exposing credential values.
- **FR-003**: A single shared engine-availability definition MUST determine,
  for every market the product supports, which search engines are offered
  (e.g. Russia: Yandex and Google; China: Baidu; Norway: Google and Bing;
  default: Google), and both the user interface and server-side validation
  MUST read it from the same source.
- **FR-004**: Provider resolution for an engine MUST walk a fixed priority
  chain and return the first configured provider; when none is configured it
  MUST produce an error that names the missing credentials.
- **FR-005**: An engine MUST NOT be silently substituted by another engine at
  resolution time: a request for an unavailable engine fails rather than
  falling back to a different engine.
- **FR-006**: All external input consumed by the foundation (engine names,
  country codes, credential presence checks) MUST be validated against
  declared schemas before use.
- **FR-007**: With no new credentials set, every existing feature MUST
  behave exactly as before (zero behavior change).

### Key Entities

- **Search engine**: An identifier of a search product (Google, Yandex,
  Baidu, Bing) that rank data can come from.
- **Market**: A country (with default language) the product already models;
  each market declares the engines offered in it.
- **SEO data provider**: An external service that can serve one or more
  engines/roles (Serper, Yandex, Bright Data, DataForSeo); has credentials
  presence (configured/not) and a priority position per engine.
- **Provider chain**: The ordered list of providers willing to serve a given
  engine.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A fresh deployment with no new credentials shows no new errors
  and no visible behavior differences compared to the previous release.
- **SC-002**: Preflight status answers "is provider X configured?" correctly
  for all four providers in 100% of manual spot checks (set/unset/empty).
- **SC-003**: 100% of engine-availability decisions (UI picker options,
  server validation, MCP validation) come from the single shared definition —
  verified by review showing no second list exists.
- **SC-004**: Every unavailable-engine request produces an error message
  naming the missing credential in 100% of tested cases.

## Assumptions

- Operator-facing credential names are stable and documented in the
  self-hosting docs (Serper key; Yandex API key plus folder id; Bright Data
  token).
- This phase adds configuration and resolution only — no network calls to the
  new providers and no UI beyond preflight status.
- The existing market list remains the source of markets; Russia and China
  are added in a later phase, so engine availability initially applies to
  existing markets only.
- Billing/credit metering for new providers is out of scope for the whole
  migration's first phases (self-host deployment model).
