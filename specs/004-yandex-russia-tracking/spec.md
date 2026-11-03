# Feature Specification: Russia Tracking — Yandex Positions and Wordstat Volumes (Phase 3)

**Feature Branch**: `004-yandex-russia-tracking`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Phase 3: end-to-end Russia market — Yandex
rank tracking (national and per-region) through the official Yandex Search
API, and keyword volumes from Wordstat."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Track positions in Yandex for Russian markets (Priority: P1)

As a site owner serving Russian customers, I create a Yandex rank tracker
for my domain in Russia (nationally or for a specific region such as
Moscow), and it records positions from real Russian Yandex results, on
demand and on schedule, with history identical in shape to Google trackers.

**Why this priority**: Yandex positions are the single most requested
Russia-specific capability and the reason this migration exists.

**Independent Test**: With Yandex credentials configured, create a Yandex
tracker for Russia with the Moscow region, run a manual check — positions
for tracked keywords appear and match manually verified yandex results for
the region.

**Acceptance Scenarios**:

1. **Given** a Yandex tracker for Russia, **When** a manual check runs,
   **Then** each keyword gets a position (or not-ranking) taken from Yandex
   organic results, with the result URL recorded.
2. **Given** a tracker with the Moscow region selected, **When** positions
   are collected, **Then** they reflect Moscow results, not the national
   blend.
3. **Given** scheduled Yandex trackers, **When** the scheduler runs,
   **Then** checks use the cheaper deferred collection path while manual
   checks use the immediate one; recorded outcomes are identical.
4. **Given** a domain with subdomains ranking, **When** matching the target
   domain, **Then** subdomain positions count toward the tracker's domain.
5. **Given** no Yandex credentials configured, **When** a Yandex check is
   attempted, **Then** the failure names the missing credential; nothing is
   recorded.
6. **Given** a keyword with no Yandex results, **When** checked, **Then**
   it is recorded as not-ranking (same semantics as Google).

---

### User Story 2 - Keyword research with real Russian volumes (Priority: P2)

As a site owner researching keywords for the Russian market, I get keyword
lists whose search volumes come from Yandex's Wordstat service (national or
regional), with fields the source cannot provide (difficulty, intent, cost
per click) clearly shown as unavailable rather than faked.

**Why this priority**: Volumes make researched keywords actionable for
Russia; the honest-unavailable pattern already exists in the product.

**Independent Test**: Research a seed keyword in a Russia-market project —
the results list shows Wordstat volumes; difficulty/intent columns show
unavailable for this market.

**Acceptance Scenarios**:

1. **Given** a Russia-market project, **When** I research a seed keyword,
   **Then** I receive related keywords with monthly search volumes sourced
   from Wordstat.
2. **Given** research results for Russia, **When** I view metrics columns,
   **Then** difficulty and intent show as unavailable (never substituted
   from another market's data).
3. **Given** a region-scoped research run, **When** volumes return,
   **Then** they reflect the selected region.
4. **Given** keywords saved from Russian research, **When** metrics are
   refreshed later, **Then** volumes refresh from Wordstat and remain
   market-correct.

---

### User Story 3 - Region picker for Russia (Priority: P3)

As a site owner, I can pick a Russian region (federal subjects and major
cities) for trackers and regional volume research, from a searchable list
served from the provider's official region directory and cached.

**Why this priority**: Regional granularity is core to Yandex optimization
practice; needs the directory plumbing but not to block stories 1–2.

**Independent Test**: Search "Екатеринбург" in the region picker — it
appears; selecting it scopes a tracker to that region.

**Acceptance Scenarios**:

1. **Given** the tracker region picker on a Russia market, **When** I type
   a region name (Russian or English), **Then** matching regions are
   offered.
2. **Given** the region directory is cached, **When** the picker opens
   repeatedly, **Then** responses stay fast without repeated provider
   directory calls.
3. **Given** a region no longer present in the provider directory, **When**
   a tracker references it, **Then** the tracker keeps working with its
   stored region and a non-blocking warning is logged.

---

### Edge Cases

- Deferred collection result arrives late or lost: the check is retried on
  the next scheduler pass, and the tracker shows a pending state rather than
  a failure until the retry window closes.
- Wordstat returns no data for a keyword: volume shows unavailable for that
  row; other keywords in the batch are unaffected.
- Mixed fleets: a project with a Google tracker and a Yandex tracker — each
  runs on its engine; results never mix.
- Quota/rate errors from Yandex: check failures name the provider and the
  batch continues with other keywords.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: With Yandex credentials configured, the system MUST collect
  Yandex organic positions for Russia-market trackers, nationally and per
  selected region, recording position or not-ranking plus result URL.
- **FR-002**: Scheduled Yandex checks MUST use the deferred collection mode;
  manual checks MUST use the immediate mode; both MUST yield equivalent
  recorded outcomes.
- **FR-003**: Domain matching MUST include subdomains, consistent with
  Google trackers.
- **FR-004**: Keyword research for Russia MUST return Wordstat-sourced
  volumes, nationally or per region, and MUST show difficulty, intent, and
  cost-per-click as unavailable — never substituted.
- **FR-005**: Saved-keyword metric refresh for Russia MUST refresh volumes
  from Wordstat.
- **FR-006**: The Russian region directory MUST be searchable by name and
  cached; trackers store their region choice independently of directory
  changes.
- **FR-007**: Missing Yandex credentials MUST produce errors naming the
  credential; no fabricated results are recorded.
- **FR-008**: Yandex data (positions, volumes) MUST be normalized to the
  same internal shapes as Google data before storage or display.

### Key Entities

- **Yandex provider**: serves the Yandex engine and Russian volumes;
  configured via its credential and cloud folder; two collection modes
  (immediate, deferred).
- **Region (Russia)**: a Yandex region directory entry (federal subject or
  city) scoping both positions and volumes.
- **Wordstat volume**: monthly search volume for a keyword, national or
  regional; carries no difficulty/intent/cpc.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 10 reference keywords tracked in Moscow, recorded Yandex
  positions match manually verified regional results within ±1 position for
  ≥80% of keywords (regional fluctuation tolerated).
- **SC-002**: Wordstat volumes in research results match the public Wordstat
  numbers for the same keyword and region in 100% of a 20-keyword sample.
- **SC-003**: Deferred (scheduled) and immediate (manual) collection produce
  identical recorded positions for the same keyword set in ≥95% of paired
  checks.
- **SC-004**: 100% of Russia research views show difficulty/intent as
  unavailable rather than blank, zero, or substituted values.

## Assumptions

- Yandex credentials are an API key plus a cloud folder identifier issued by
  the service owner; their names and pricing follow the provider's public
  terms.
- Russia-market research list generation (seed expansion) uses
  provider-suggested related queries; Google-derived suggestion sources are
  not used for Russia.
- AI visibility, backlinks, and other non-SERP features remain untouched for
  Russia in this phase.
- Wordstat numbers are the source of truth; the product does not adjust or
  blend them.
