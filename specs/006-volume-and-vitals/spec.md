# Feature Specification: Non-Russia Keyword Volumes and Free Vitals (Phase 5, optional)

**Feature Branch**: `006-volume-and-vitals`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Phase 5: optional — keyword volume provider
for remaining markets (e.g. Norway) and replacing the paid page-vitals
source with the free Google measurement service."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Page vitals measured without a paid provider (Priority: P1)

As a site owner running site audits, my Core Web Vitals measurements
(performance, accessibility, best practices, SEO scores and field metrics)
come from Google's free measurement service, so audits no longer depend on
the incumbent paid provider for this data.

**Why this priority**: Zero recurring cost, removes a paid dependency, and
is fully decoupled from the provider migration's critical path — cheapest
independent slice.

**Independent Test**: Run an audit page vitals measurement on a public URL;
scores and field metrics (loading, interactivity, layout stability, first
byte) appear as before.

**Acceptance Scenarios**:

1. **Given** an audit of a page, **When** vitals are measured, **Then** the
   four scores plus the field metrics appear with the same meanings as
   today.
2. **Given** the incumbent provider's credential absent, **When** an audit
   runs, **Then** vitals still complete via the free service.
3. **Given** a page that cannot be measured, **When** the audit runs,
   **Then** the failure is reported per page without aborting the audit.

---

### User Story 2 - Keyword volumes for remaining markets (Priority: P2, conditional)

As a site owner in a market whose volumes the incumbent provider served
(e.g. Norway), keyword volumes continue to be available through a
replacement volume provider, with difficulty/coverage differences shown
honestly.

**Why this priority**: Volumes for non-Russia markets matter to research
workflows, but positions already work without them — conditional on
procuring the replacement subscription.

**Independent Test**: Research a Norwegian keyword with the volume provider
configured — volumes and CPC appear; difficulty shows per the new source's
actual coverage.

**Acceptance Scenarios**:

1. **Given** the replacement volume provider configured, **When** research
   or metric refresh runs for a covered market, **Then** volumes (and cost
   data where the source provides it) appear.
2. **Given** the provider unconfigured, **When** research runs for a
   covered market, **Then** volumes show as unavailable — the position
   features are unaffected.
3. **Given** the provider returns no row for a keyword, **When** results
   render, **Then** that keyword's volume shows unavailable without
   affecting the rest.

---

### Edge Cases

- Volume provider subscription lapses: volumes degrade to unavailable;
   nothing else breaks; the operator is informed via provider status.
- Free vitals service rate ceiling: audits pace their vitals measurements;
   queues rather than failing.
- Mixed markets in one project (Russia + Norway): each market resolves its
  own volume source; no cross-market substitution.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Page vitals during audits MUST be measured by Google's free
   measurement service and normalized to the existing vitals shape.
- **FR-002**: Audit vitals MUST NOT require the incumbent paid provider's
   credential.
- **FR-003**: Vitals measurement failures MUST be per-page and non-fatal to
   the audit.
- **FR-004**: When a replacement volume provider is configured, keyword
   volumes for its covered markets MUST appear in research and metric
   refresh, with cost/difficulty fields shown only as the source actually
   provides them.
- **FR-005**: Volume unavailability MUST degrade to visible "unavailable"
   states, never to zero, blank, or substituted numbers.
- **FR-006**: Volume source resolution MUST be per market via the shared
   routing definition.

### Key Entities

- **Free vitals measurement**: Google-hosted page measurement; per-page
   scores and field metrics.
- **Volume provider (replacement)**: optional subscription-backed source of
   keyword volumes for a defined market list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Audits complete vitals for 100% of pages on a 50-page site
   without the incumbent provider credential, within the audit's normal
   duration budget.
- **SC-002**: Vitals scores from the free service fall within normal
   measurement variance of the previous source on a 10-page sample
   (variance documented at acceptance).
- **SC-003**: With the volume provider configured, ≥95% of researched
   keywords in a covered market display a volume or an explicit
   unavailable state — never a fabricated number.

## Assumptions

- The vitals service's free rate ceiling comfortably covers audit page
   volumes at expected customer scale; pacing covers bursts.
- The replacement volume provider (Ahrefs or similar) is a paid
   subscription procured separately; this feature activates only when its
   credential is present.
- Russia volumes are already served by Wordstat (feature 004) and are not
   in scope here.
