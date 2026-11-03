# Feature Specification: Baidu and Bing Rank Checks via Bright Data (Phase 4)

**Feature Branch**: `005-brightdata-baidu-bing`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Phase 4: rank tracking for China (Baidu) and
Bing markets through the Bright Data provider."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Track positions in Baidu for Chinese markets (Priority: P1)

As a site owner with Chinese customers, I create a Baidu rank tracker for my
domain in China, and it records positions from Baidu organic results on
demand and on schedule, with history like any other engine.

**Why this priority**: China is unreachable by every other provider in the
fleet; Baidu is the only engine offered there.

**Independent Test**: With a Bright Data credential configured, create a
Baidu tracker for China, run a manual check — positions appear and match
manually verified Baidu results.

**Acceptance Scenarios**:

1. **Given** a Baidu tracker for China, **When** a check runs, **Then** each
   keyword receives a position (or not-ranking) from Baidu organic results
   with the result URL recorded.
2. **Given** the market China, **When** the engine picker renders, **Then**
   Baidu is the only engine offered.
3. **Given** no Bright Data credential, **When** a Baidu check runs,
   **Then** the failure names the missing credential and nothing is
   recorded.
4. **Given** subdomains of the tracked domain ranking in Baidu, **When**
   matching runs, **Then** they count toward the tracker's position.

---

### User Story 2 - Track positions in Bing (Priority: P2)

As a site owner (e.g. in Norway or the US), I create a Bing tracker, and it
records Bing organic positions for my market, alongside my existing Google
trackers.

**Why this priority**: Bing is the second western engine; some customer
segments (enterprise/Outlook-adjacent audiences) track it deliberately.

**Independent Test**: Create a Bing tracker for Norway; manual check returns
Bing positions; history charts like Google's.

**Acceptance Scenarios**:

1. **Given** a Bing tracker for a Bing-supported market, **When** a check
   runs, **Then** positions come from Bing organic results for that market.
2. **Given** the same domain tracked on Google and Bing in one project,
   **When** both run, **Then** each engine's results are recorded
   separately and never mixed.

---

### Edge Cases

- Provider outage or quota errors: checks fail with the provider named;
  scheduled runs continue with remaining keywords.
- Engines offered per market remain the single source (China → Baidu only;
  Bing only where declared); requests outside the declaration fail
  validation, not at the provider.
- Chinese-language keywords in Baidu: matched as-is; no transliteration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: With a Bright Data credential configured, the system MUST
  collect Baidu organic positions for China-market trackers and Bing
  organic positions for markets where Bing is offered.
- **FR-002**: Engine availability per market MUST remain driven by the
  shared declaration; Baidu MUST be offered for China only, Bing only where
  declared.
- **FR-003**: Domain matching MUST include subdomains, consistent with
  other engines.
- **FR-004**: Missing Bright Data credentials MUST produce errors naming
  the credential; no fabricated results.
- **FR-005**: Provider failures during a run MUST fail the affected checks
  with the provider named and MUST NOT abort the remaining run.
- **FR-006**: Baidu and Bing results MUST be normalized to the same internal
  shapes as Google/Yandex results.

### Key Entities

- **Bright Data provider**: serves Baidu and Bing engines; configured via
  its credential; one unit per keyword check at its own pricing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 10 reference keywords, recorded Baidu positions match
  manually verified results within ±1 position for ≥80% of keywords.
- **SC-002**: Bing checks complete for all declared Bing markets in 100% of
  spot checks.
- **SC-003**: 100% of engine/market validation happens before any provider
  request (no paid calls for impossible combinations).

## Assumptions

- Bright Data access, billing, and account standing are the operator's
  responsibility (the provider restricts some jurisdictions); the product
  treats it as any other optional provider.
- No keyword volumes, backlinks, or AI data ship for Baidu/Bing in this
  phase; Chinese volumes in particular remain out of scope.
- Second-tier Chinese engines (Sogou, 360) remain unsupported — declared
  product limitation per the migration decisions document.
