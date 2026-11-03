# Feature Specification: Google Rank Checks via Serper (Phase 2)

**Feature Branch**: `003-serper-google-provider`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Phase 2: the first live alternative provider —
Google rank checks and SERP snapshots through Serper, alongside DataForSeo."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Google trackers run without a DataForSeo account (Priority: P1)

As a self-hosting operator with only a Serper credential set, my Google rank
trackers (any market, including Norway) collect positions on schedule and on
demand, with history and position changes shown exactly as DataForSeo-backed
trackers show them.

**Why this priority**: Decoupling Google rank tracking from DataForSeo is the
first real step of the replacement and the cheapest to verify.

**Independent Test**: Fresh deployment, Serper credential only, no DataForSeo
key — create a Google tracker for Norway, run a manual check, positions and
top-results appear in the tracker UI.

**Acceptance Scenarios**:

1. **Given** Serper configured and DataForSeo absent, **When** a Google
   tracker check runs, **Then** a position (or "not ranking") plus the
   top-results snapshot is recorded for the tracked domain.
2. **Given** both Serper and DataForSeo configured, **When** a Google check
   runs, **Then** the higher-priority provider (Serper) serves it, and the
   choice follows the shared provider chain.
3. **Given** only DataForSeo configured (today's deployments), **When** a
   Google check runs, **Then** it is served by DataForSeo exactly as today.
4. **Given** a scheduled run with many Google trackers, **When** the
   scheduler executes it, **Then** all checks complete within the existing
   per-run budget, counting one unit per keyword check for Serper.
5. **Given** Serper returns an error or times out, **When** a check runs,
   **Then** the tracker shows a clear check failure naming the provider,
   and no partial/incorrect position is recorded.
6. **Given** a domain ranking on page 1, **When** the snapshot is fetched,
   **Then** results are retrieved in a single request covering up to depth
   100 (no per-page crawling), and the tracked position matches the organic
   listing including subdomains of the target domain.

---

### User Story 2 - Keyword SERP analysis without DataForSeo (Priority: P2)

As a site owner doing keyword research, when Serper is the active Google
provider I can open the SERP panel for a keyword and see the organic results
(and local pack where present) with the same fields as today, cached against
repeat opens.

**Why this priority**: Research is the second Google-dependent surface after
tracking; it reuses the same provider call, so marginal cost is small.

**Independent Test**: With Serper configured, open the SERP panel for a
Norwegian keyword; results render; reopening within the cache window does
not trigger a new provider request.

**Acceptance Scenarios**:

1. **Given** Serper active, **When** I open the SERP panel for a keyword,
   **Then** organic results with position, URL, title, and domain appear.
2. **Given** the same keyword reopened within the cache window, **When** the
   panel loads, **Then** the cached snapshot is shown (no duplicate provider
   spend).
3. **Given** DataForSeo still active per the provider chain, **When** the
   panel opens, **Then** behavior is unchanged from today.

---

### Edge Cases

- Keyword with no results: recorded as not-ranking; snapshot shows an empty
  organic list, mirroring existing "no results" handling.
- Depth beyond what the provider returns in one call: capped at the
  provider's single-request maximum; requests for deeper checks are clamped
  with the limit surfaced to the user.
- Rate/quota errors from the provider: surfaced as provider failures with
  the provider named; scheduled batches continue with remaining keywords
  rather than aborting the whole run.
- Mobile vs desktop devices: both honored per tracker configuration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: With a Serper credential configured, the system MUST serve
  Google rank checks for all markets through Serper, producing the same
  recorded outcomes (position or not-ranking, URL, top results) as the
  existing provider path.
- **FR-002**: Domain matching MUST count subdomains of the tracked domain
  when finding its organic position.
- **FR-003**: Provider selection for Google MUST follow the shared provider
  chain; deployments without the Serper credential MUST keep using the
  incumbent provider with identical behavior.
- **FR-004**: A provider failure during a check MUST mark that check failed
  with the provider identified, MUST NOT record a fabricated position, and
  MUST NOT abort unrelated checks in the same run.
- **FR-005**: Scheduled Google runs MUST respect the existing per-run budget
  model, with one unit counted per keyword check under Serper.
- **FR-006**: SERP snapshots for keywords MUST be served by the active
  Google provider and cached for repeat views within the existing cache
  window.
- **FR-007**: Requests deeper than the provider's single-request maximum
  MUST be clamped and the effective limit communicated.

### Key Entities

- **Rank check result**: position/not-ranking, URL, snapshot of top organic
  results; provider-sourced but provider-neutral in storage.
- **Provider (Serper)**: serves the Google engine; configured via its
  credential; consumes one unit per keyword check at its own pricing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deployment with only Serper configured completes Google rank
  checks for all tested markets (minimum: US, Norway) with results visible
  in tracker history in 100% of spot checks.
- **SC-002**: Position parity — for a sample of 20 tracked keywords, the
  recorded position matches the live Google result within tolerance ±1
  position for ≥90% of keywords.
- **SC-003**: Zero regressions for DataForSeo-only deployments (existing
  automated suites pass unchanged).
- **SC-004**: 100% of provider outages produce named-provider failures with
  no fabricated positions.

## Assumptions

- Serper's single-request result maximum (100) is accepted as the depth cap
  for Google checks under Serper; deeper depths remain available under the
  incumbent provider path.
- Mobile/desktop device handling maps directly to provider parameters.
- Volume, difficulty, and intent data are untouched by this feature — they
  remain on their current sources.
- Billing for hosted mode is unchanged (self-host priority per the
  migration document).
