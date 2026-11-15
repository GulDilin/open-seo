# Feature Specification: Retiring the Incumbent Provider from Rank Tracking (Phase 6)

**Feature Branch**: `007-dataforseo-serp-exit`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Phase 6: after parallel operation, Google
rank tracking no longer requires the incumbent provider; remaining
incumbent-dependent roles get an explicit keep/replace decision."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rank tracking works with no incumbent provider credential (Priority: P1)

As a self-hosting operator, I run Google, Yandex, Baidu, and Bing trackers
with only the new providers' credentials set (no DataForSeo key), and all
position collection, history, and scheduling behave normally.

**Why this priority**: This is the exit criterion of the whole migration —
rank tracking decoupled from the incumbent.

**Independent Test**: Remove the DataForSeo credential from a deployment
with Serper + Yandex (+ Bright Data) configured; all trackers keep
collecting; nothing in the tracking surface reports a missing provider.

**Acceptance Scenarios**:

1. **Given** new providers configured and the incumbent credential absent,
   **When** trackers of every supported engine run, **Then** positions are
   collected and stored as usual.
2. **Given** the incumbent credential absent, **When** the operator opens
   preflight, **Then** rank tracking is reported as fully available (the
   incumbent shows as not configured without warnings implying breakage).
3. **Given** a deployment still holding the incumbent credential, **When**
   Google checks run, **Then** they are served by the new provider per the
   priority chain — presence of the incumbent credential alone does not
   route traffic to it for engines the fleet covers.
4. **Given** the fleet lacks an engine's provider (e.g. no Bright Data),
   **When** a Bing check runs, **Then** the failure names what to configure.

---

### User Story 2 - Remaining incumbent-dependent features state their dependency honestly (Priority: P2)

As an operator, features still using the incumbent provider (backlinks
overview, AI visibility, local listings, domain overview) state clearly in
setup status and on their screens that they need the incumbent credential,
while everything else works without it.

**Why this priority**: Prevents silent breakage confusion during the long
tail of the migration.

**Independent Test**: With the incumbent credential absent, open the
backlinks screen — a clear "requires [incumbent provider]" empty state
appears; keyword tracking screens show no such notice.

**Acceptance Scenarios**:

1. **Given** no incumbent credential, **When** an incumbent-dependent screen
   opens, **Then** an explanatory empty state names the provider and where
   to configure it.
2. **Given** no incumbent credential, **When** tracking and research
   surfaces open, **Then** no incumbent-related notices appear.
3. **Given** the incumbent credential present, **When** an
   incumbent-dependent screen opens, **Then** it works exactly as today.

---

### Edge Cases

- Operator removes the incumbent credential while incumbent-dependent
  features have cached data: cached data remains visible; refreshes show
  the explanatory state.
- A market whose volume depends on the incumbent (labs-served markets)
  without the incumbent credential and without the replacement volume
  provider (feature 006 not procured): volumes show unavailable; research
  positions still work.
- Rollback path: re-adding the incumbent credential restores
  incumbent-dependent features without any data migration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Rank position collection for all supported engines MUST work
  without the incumbent provider's credential, using the new provider fleet.
- **FR-002**: The incumbent provider MUST NOT receive traffic for engines
  the fleet covers, regardless of whether its credential is present.
- **FR-003**: Every user-facing feature still requiring the incumbent
  provider MUST show an explicit dependency state when the credential is
  absent; features not requiring it MUST NOT show incumbent-related
  notices.
- **FR-004**: Removing the incumbent credential MUST NOT delete or hide
  previously collected data for any feature.
- **FR-005**: Re-adding the incumbent credential MUST restore
  incumbent-dependent features without data migration or operator repair.
- **FR-006**: Volume availability per market MUST degrade to explicit
  unavailable states where neither Wordstat, the replacement volume
  provider, nor the incumbent is configured.

### Key Entities

- **Incumbent provider (DataForSeo)**: remaining roles after exit —
  backlinks, AI visibility, local listings, domain overview (per the
  keep/replace decision recorded at acceptance).
- **Provider fleet**: Serper (Google), Yandex (Yandex + volumes for
  Russia), Bright Data (Baidu, Bing); engines covered by the fleet never
  route to the incumbent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A credential set without the incumbent key runs 100% of rank
  tracking scenarios (create, schedule, manual run, history view) for every
  supported engine.
- **SC-002**: In a 2-week parallel-run window before cutover, position
  disagreement between the incumbent and new Google paths stays within
  documented tolerance (±1 position for ≥90% of checks) on a shared tracker
  set.
- **SC-003**: 100% of incumbent-dependent surfaces show the dependency
  state when the credential is absent (audited screen by screen).
- **SC-004**: Zero data loss on credential removal/re-add (spot-check
  histories before and after).

## Assumptions

- Features 001–005 are live and have passed their acceptance criteria,
  including the parallel-run tolerance window.
- The keep/replace decision for each remaining incumbent role (backlinks,
  AI visibility, local, domain overview) is recorded separately; this
  feature only makes existing dependencies honest, it does not migrate
  those roles.
- Hosted billing implications of the exit are handled by the separate
  hosted-mode decision in the migration document (out of scope here).
