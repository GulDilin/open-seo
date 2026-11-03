# Feature Specification: Multi-Engine Rank Tracking Domain Model (Phase 1)

**Feature Branch**: `002-tracking-domain-model`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Phase 1: rank trackers gain a search engine;
Russia and China become selectable markets; UI and MCP accept the engine."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A rank tracker is bound to one search engine (Priority: P1)

As a site owner creating a rank tracker, I choose which search engine it
tracks (Google, Yandex, Baidu, or Bing) in addition to market and language,
and existing trackers keep tracking Google exactly as before, so my history
stays intact while new trackers can target other engines.

**Why this priority**: The engine is the core domain attribute every later
phase depends on; without it nothing engine-specific can exist.

**Independent Test**: Create a tracker with engine Yandex for Russia (data
fetching arrives later — creation and validation work now) and verify a
Google tracker created before the change still collects positions.

**Acceptance Scenarios**:

1. **Given** the tracker creation form, **When** I pick market Russia,
   **Then** the engine picker offers Yandex and Google and no others.
2. **Given** market China, **When** the engine picker renders, **Then** it
   offers Baidu only.
3. **Given** market Norway, **When** the engine picker renders, **Then** it
   offers Google and Bing.
4. **Given** any market without an explicit engine list, **When** the picker
   renders, **Then** Google is offered (current behavior preserved).
5. **Given** an existing tracker created before this feature, **When** it
   runs, **Then** it tracks Google and its position history is unchanged.
6. **Given** a project with a tracker for the same domain and market on
   Google, **When** I create a second tracker for the same domain and market
   on Yandex, **Then** both coexist (uniqueness is per engine).
7. **Given** I omit the engine, **When** creating a tracker, **Then** it
   defaults to Google.

---

### User Story 2 - Russia and China are selectable markets (Priority: P2)

As a site owner with customers in Russia and China, I can select Russia
(Russian language) and China (Chinese) as the market for projects and
trackers, so my work is no longer limited to western markets.

**Why this priority**: Markets unlock the engines — without Russia in the
list there is nothing to point Yandex at.

**Independent Test**: Create a project with market Russia and a tracker in
it; both persist and display correctly.

**Acceptance Scenarios**:

1. **Given** the market picker, **When** I open it, **Then** Russia and
   China appear with their flags/labels like any other country.
2. **Given** a Russia-market project, **When** I set its language options,
   **Then** Russian is the default language.
3. **Given** a China-market project, **When** researching keywords,
   **Then** the product honestly reports that keyword volume data is not
   available for this market yet (it does not fall back to another country's
   numbers).
4. **Given** a Russia-market project, **When** researching keywords,
   **Then** the product reports volume data availability per the Wordstat
   provider once later phases land; until then it reports unavailable.

---

### User Story 3 - Agents create engine-aware trackers (Priority: P3)

As an AI agent using the MCP tools, I can pass an optional search engine
when creating or reading rank trackers, so automations for Yandex or Baidu
markets work the same way as Google ones.

**Why this priority**: Parity between UI and MCP is a product principle;
still, agents have a workaround (UI) so this is P3.

**Independent Test**: Call the create-tracker tool with engine Yandex and
market Russia; it succeeds and the tracker appears in the UI.

**Acceptance Scenarios**:

1. **Given** the MCP create-tracker tool, **When** called without an engine,
   **Then** it creates a Google tracker (backward compatible).
2. **Given** the MCP create-tracker tool, **When** called with engine Baidu
   for a market that does not offer Baidu, **Then** it returns a validation
   error naming the supported engines for that market.
3. **Given** the MCP tracker-reading tools, **When** a tracker has a
   non-Google engine, **Then** responses include the engine value.

---

### Edge Cases

- Tracker for an engine whose data provider is not yet implemented (all
  non-Google engines in this phase): creation and scheduling configuration
  succeed; the first actual check reports a clear "no provider configured
  for this engine" status rather than silently recording failures.
- Two trackers, same domain/market, different engines: both run
  independently; results never mix between engines.
- Local (city-level) trackers: engine applies as well; for engines without
  a city registry yet, city targeting is not offered until the engine's
  phase lands.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every rank tracker MUST record exactly one search engine;
  omitting it MUST default to Google.
- **FR-002**: Two trackers MUST be able to coexist for the same domain,
  market, and city if their engines differ; duplicates within the same
  engine MUST still be rejected.
- **FR-003**: The set of engines offered for a market MUST come from the
  shared engine-availability definition (built in feature 001) in the UI,
  the server validation, and MCP tool validation.
- **FR-004**: All persisted trackers created before this feature MUST be
  readable and runnable as Google trackers without migration action by the
  operator.
- **FR-005**: Russia (default language Russian) and China MUST be selectable
  as markets for projects and trackers, on par with existing markets.
- **FR-006**: Keyword volume availability MUST be reported honestly per
  market: markets without a volume provider show data as unavailable rather
  than substituting another market's data.
- **FR-007**: MCP tools that create or return rank trackers MUST accept and
  expose the engine, defaulting to Google when absent.

### Key Entities

- **Rank tracker**: domain + market + optional city + language + devices +
  depth + schedule; now also exactly one search engine.
- **Market**: as in feature 001; Russia and China added, each declaring its
  offered engines and its keyword-data situation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of pre-existing trackers continue their schedules and
  history with zero operator action after upgrade.
- **SC-002**: Engine options shown for any market match the server-accepted
  engines for that market in 100% of automated checks.
- **SC-003**: Russia and China are creatable as project markets in 100% of
  attempts; their trackers persist engine and market correctly across
  restarts.
- **SC-004**: 100% of engine/market validation errors name the supported
  options.

## Assumptions

- Position collection for non-Google engines lands in later phases; this
  phase covers creation, validation, persistence, and honest unavailability
  reporting.
- The market registry keeps its existing numeric internal keys; Russia and
  China receive keys consistent with international numeric country codes.
- Pricing/credit estimates for non-Google engines show provider-priced
  notes; the credit-based estimates remain Google-only until provider
  integration lands.
