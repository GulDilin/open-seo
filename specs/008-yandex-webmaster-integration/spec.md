# Feature Specification: Yandex Webmaster Integration

**Feature Branch**: `008-yandex-webmaster-integration`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "Добавить интеграцию с Yandex Webmaster API — аналог существующей GSC-интеграции: подключение через Яндекс ID OAuth, список сайтов вебмастера, поисковые запросы (показы/клики/позиция за период) на странице Search Performance, базовая сводка сайта, MCP-инструмент для агента."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a Yandex Webmaster site to a project (Priority: P1)

A user whose audience is in Russia tracks a site in Yandex. Today OpenSEO only reads its Google performance. The user opens the project's integrations page, connects their Yandex account, and picks one verified site from Yandex Webmaster. The project now remembers which Yandex site belongs to it and which member's Yandex grant to use.

**Why this priority**: Without a connection there is no data; every other story depends on it.

**Independent Test**: Connect a Yandex account, choose a site, and see the project report "connected" with that site; disconnect and it reports "not connected" again.

**Acceptance Scenarios**:

1. **Given** the deployment has Yandex OAuth configured, **When** the user starts the connect flow and approves Yandex's permissions, **Then** they return to the page they started from and can pick from the verified sites in their Yandex Webmaster account.
2. **Given** the user has several sites in Yandex Webmaster, **When** they open the site picker, **Then** only sites whose ownership is confirmed in Yandex can be selected, and unverified ones are visibly not selectable.
3. **Given** a project already has a Yandex site selected, **When** another site is chosen, **Then** the selection is replaced (one Yandex site per project).
4. **Given** the deployment has no Yandex OAuth client configured, **When** the user views the integration, **Then** they see a setup-required state naming the missing configuration, not a broken button.
5. **Given** the user disconnects the site, **Then** the project stops showing Yandex data and any stored link to that Yandex account is removed when no other project needs it.
6. **Given** the Yandex grant expired or was revoked on Yandex's side, **When** data is requested, **Then** the user is asked to reconnect instead of seeing a generic failure.

---

### User Story 2 - See Yandex search performance next to Google's (Priority: P2)

The user opens the Search Performance page and, alongside the existing Google tabs, opens a Yandex tab. For the selected period they see the site's Yandex popular search queries — impressions, clicks, average position — and a site summary from Yandex Webmaster: quality index, pages in search, excluded pages, and indexing status. Rows honestly reflect what Yandex returned: the period shown is the one Yandex reports (Yandex may shorten the requested window), and CTR is derived, not reported by Yandex.

**Why this priority**: This is the data the user connected for; it is the core value after US1.

**Independent Test**: With a connected site that has Yandex search traffic, open the Yandex tab, pick a period, and see a table of queries with impressions/clicks/position plus the site summary; a site without traffic shows an honest empty state.

**Acceptance Scenarios**:

1. **Given** a connected Yandex site with search traffic, **When** the user opens the Yandex tab, **Then** queries are listed with impressions, clicks, derived CTR, and average position for the chosen period and device type.
2. **Given** the user changes the period, **Then** the data and the displayed window update to what Yandex reports for that period.
3. **Given** a connected site with no query data (new site, or Yandex has not loaded data yet), **When** the user opens the tab, **Then** they see an explanation that Yandex has no data for the period, not zeros presented as real metrics.
4. **Given** the project has no Yandex connection, **When** the user opens the Yandex tab, **Then** they see the connect flow instead of an empty table.
5. **Given** the site summary is available, **When** the tab renders, **Then** the summary shows quality index, pages in search, excluded pages, problem counts by severity, and the site's indexing status, each labeled with what Yandex reports it as.

---

### User Story 3 - Agent reads Yandex search performance (Priority: P3)

A user works with an AI assistant through OpenSEO's agent tools. They ask "what queries does my site show for in Yandex?" The agent uses a read-only Yandex tool scoped to a project the caller may access, returning the popular queries with impressions/clicks/position for a period plus the site summary, with honest notes about what Yandex does and does not report (totals are floors over a capped pool, no query-by-page join, no previous-period series). When the project has no Yandex connection, the tool answers with a connect link instead of fabricated numbers.

**Why this priority**: Extends the same first-party data to the agent surface; independent of the UI story.

**Independent Test**: Call the agent tool against a connected project and receive queries plus summary with a connect link when not connected.

**Acceptance Scenarios**:

1. **Given** a project with a connected Yandex site, **When** the agent calls the tool with a period, **Then** it receives up to the per-call row cap of popular queries ordered as requested, plus the site summary.
2. **Given** no connection, **When** the tool is called, **Then** the response explains that and includes a link to connect.
3. **Given** the Yandex grant is dead, **When** the tool is called, **Then** the response prompts reconnection rather than reporting an error without next steps.

---

### User Story 4 - Self-hosted operator enables Yandex Webmaster (Priority: P4)

A self-hosting operator wants Yandex data for their users. Following the self-hosting guide, they register the required Yandex OAuth app, set the new environment variables (separate from any existing Yandex search API key, which belongs to a different product), and restart. Startup guidance tells them whether the Yandex integration is configured, partially configured, or missing.

**Why this priority**: Operators gate the feature for self-hosters; no data flows without it, but it is configuration, not product behavior.

**Independent Test**: Set/unset the configuration and observe startup status messages change accordingly.

**Acceptance Scenarios**:

1. **Given** no Yandex OAuth variables are set, **When** the operator starts the deployment, **Then** startup status reports the Yandex integration as optional and not configured, with a pointer to the setup guide.
2. **Given** only one of the two Yandex OAuth variables is set, **When** the deployment starts, **Then** startup status warns that both are required.
3. **Given** both are set, **When** a user tries to connect, **Then** the flow works end to end.

---

## Edge Cases

- Yandex returns a shorter window than requested (data finalization lag): the UI and tool responses show the window Yandex reports, never the requested one.
- The Yandex site list contains unverified sites or mirrors: only verified sites are selectable; Yandex's own main-mirror designation wins over URL guessing.
- A Yandex grant outlives its refresh token (both expire together per Yandex): the product surfaces a reconnect prompt; it does not silently pretend the data is unavailable for other reasons.
- Values Yandex does not report (CTR, previous period) are derived or omitted — never invented.
- Multiple members connect different Yandex accounts: each member's grant is stored per user, and the project uses the connector's grant.
- The Yandex site is removed from the user's Webmaster account after connecting: requests fail with Yandex's not-found semantics and the UI says the site is no longer available in the connected account.

## Requirements *(mandatory)*

### Functional Requirements

1. The system must let a user authorize a Yandex Webmaster connection through Yandex's own consent screen and store the resulting grant encrypted at rest.
2. The system must let a user with integration-manage permission pick exactly one verified Yandex site per project and replace or remove that selection.
3. The system must expose the connected site's popular search queries for a chosen period and device type, with impressions, clicks, derived CTR, and average positions as Yandex reports them.
4. The system must expose a site summary: quality index, pages in search, excluded pages, problem counts by severity, and indexing status.
5. The system must surface Yandex data both in the Search Performance page (a Yandex tab) and through a read-only agent tool scoped to an authorized project.
6. Every Yandex response must be validated at the boundary before use, and failures must be reported with actionable reasons (not configured, not connected, needs reconnect, Yandex error).
7. Self-hosted deployments must get explicit setup status for the Yandex integration, and the self-hosting guide must cover app registration, permissions, and the new environment variables.
8. The Yandex Webmaster connection must be independent from any Yandex search API key configuration already used for rank tracking.

### Key Entities

- **Yandex grant**: a per-user authorization to access that user's Yandex Webmaster data (encrypted credentials, refreshable, revocable).
- **Yandex connection**: the mapping of one project to one verified Yandex site, recording whose grant to use and the Yandex site identifier (an opaque value that cannot be derived from a URL).

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. A user with a Yandex-verified site can complete connect → pick site → see queries in under 3 minutes.
2. The Yandex tab renders the reported query window, and shows an honest empty state when Yandex has no data for the period.
3. The agent tool returns query rows plus summary for a connected project, and a connect link for an unconnected one, in a single call.
4. Startup self-host status distinguishes configured / partially configured / not configured for the Yandex integration.

## Assumptions

- Yandex Webmaster's public API (v4, api.webmaster.yandex.net) and Yandex ID OAuth remain available with the documented capabilities; anything it does not expose (e.g. per-page query joins, previous-period series, unlimited history) is treated as out of scope and stated, not worked around with invented numbers.
- Yandex requires both the host-info and the verify permission for data endpoints; the connect flow requests both, and the product communicates that this is Yandex's only available data access mode (there is no read-only data scope).
- One Yandex site per project is enough for the first version, matching the existing one-property-per-project model for Google Search Console.
- Data is fetched live per request; no history is stored for Yandex in v1.
