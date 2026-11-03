# Research: Yandex Webmaster API (verified 2026-10-26)

All facts below were verified against live documentation on 2026-10-26. Sources
are linked inline. Anything not confirmable is listed under "Not available /
out of scope".

## 1. Base API

- Base URL: `https://api.webmaster.yandex.net`, API version **v4**.
  Source: <https://yandex.ru/dev/webmaster/doc/ru/reference/hosts.md>
- Authorization header: `Authorization: OAuth <user-token>` — **not** `Bearer`,
  even though the OAuth token endpoint answers `"token_type": "bearer"`. An
  OAuth library that builds the header from `token_type` gets rejected.
  Sources: <https://yandex.ru/dev/webmaster/doc/ru/tasks/how-to-get-oauth.md>
  (401 without token), header format cross-confirmed by
  <https://dev.to/jbobbink/building-a-yandex-seo-mcp-server-six-traps-in-the-yandex-webmaster-api-1bc5> (trap 3).
- Errors carry JSON bodies with `error_code`, `error_message`, and where
  applicable `available_user_id` / `host_id`. Common codes:
  - 403 `INVALID_USER_ID` — uid in path ≠ token owner (body contains the correct `available_user_id`).
  - 404 `HOST_NOT_FOUND` / `HOST_NOT_VERIFIED` / `HOST_NOT_INDEXED` / `HOST_NOT_LOADED`.
  - 429 quota/rate limit.

## 2. Endpoints used by the MVP

### 2.1 uid — `GET /v4/user`

Response: `{ "user_id": <int64> }`. The uid is required in every other path.
Source: <https://yandex.ru/dev/webmaster/doc/ru/reference/user.md>

### 2.2 Sites — `GET /v4/user/{user-id}/hosts`

Response: `{ hosts: [{ host_id, ascii_host_url, unicode_host_url?, verified, main_mirror? }] }`.
`host_id` is an opaque string like `https:ya.ru:443` — **it cannot be derived
from a URL**; the site list is the only source. `verified` gates selection.
Sources: <https://yandex.ru/dev/webmaster/doc/ru/reference/hosts.md>,
<https://yandex.ru/dev/webmaster/doc/ru/reference/hosts-id.md>

### 2.3 Site info — `GET /v4/user/{user-id}/hosts/{host-id}`

Adds `host_data_status` (`NOT_INDEXED` | `NOT_LOADED` | `OK`) and
`host_display_name`. There is **no** `last_access`/`tax_date`/`url_count` in
this response (verified — those fields do not exist in the documented schema).
Source: <https://yandex.ru/dev/webmaster/doc/ru/reference/hosts-id.md>

### 2.4 Site summary — `GET /v4/user/{user-id}/hosts/{host-id}/summary`

Response: `{ sqi: int32, excluded_pages_count: int64, searchable_pages_count: int64, site_problems: { FATAL?, CRITICAL?, POSSIBLE_PROBLEM?, RECOMMENDATION? } }`.
`sqi` = Yandex Site Quality Index (ИКС). Source:
<https://yandex.ru/dev/webmaster/doc/ru/reference/host-id-summary.md>

### 2.5 Popular queries — `GET /v4/user/{user-id}/hosts/{host-id}/search-queries/popular`

Query params: `order_by` (**required**: `TOTAL_SHOWS` | `TOTAL_CLICKS`),
`query_indicator` (repeatable; `TOTAL_SHOWS`, `TOTAL_CLICKS`,
`AVG_SHOW_POSITION`, `AVG_CLICK_POSITION`), `device_type_indicator`
(`ALL` default, `DESKTOP`, `MOBILE_AND_TABLET`, `MOBILE`, `TABLET`),
`date_from`/`date_to` (datetime), `limit` (1–500, default 500), `offset`.

Response: `{ queries: [{ query_id, query_text, indicators: { <indicator>: number } }], date_from, date_to, count }`.
An indicator "may be absent if its value is not defined" — the adapter must
treat every indicator as optional. `count` = total queries available.

Pagination: max **500 rows per request**, pool capped at **3,000** queries
total; walk pages serially and stop on a short page. Source:
<https://yandex.ru/dev/webmaster/doc/ru/reference/host-search-queries-popular.md>

Field-name mapping (Constitution IV boundary normalization):
`TOTAL_SHOWS` → `impressions`, `TOTAL_CLICKS` → `clicks`,
`AVG_SHOW_POSITION` → `avgShowPosition`, `AVG_CLICK_POSITION` →
`avgClickPosition`. CTR is **derived** (clicks/impressions), never reported.

### 2.6 Indexing history — `GET /v4/user/{user-id}/hosts/{host-id}/indexing/history`

`{ indicators: { HTTP_2XX|HTTP_3XX|HTTP_4XX|HTTP_5XX|OTHER: [{ date, value }] } }`.
**Date format quirk**: `2016-01-01T00:00:00,000+0300` — comma before
milliseconds; `new Date()` silently rejects it (normalize first). Source:
<https://yandex.ru/dev/webmaster/doc/ru/reference/hosts-indexing-history.md>
Deferred from v1 MVP (summary's `searchable_pages_count` + `host_data_status`
cover the "indexing status" need); noted in tasks.md.

### 2.7 Recrawl — `POST /v4/user/{user-id}/hosts/{host-id}/recrawl/queue`

Body `{ "url": ... }` → 202 `{ task_id, quota_remainder }`; 409
`URL_ALREADY_ADDED`; 429 `QUOTA_EXCEEDED` (with `daily_quota`,
`exceeded_until`). A write operation — **deferred**; v1 ships read-only.
Source: <https://yandex.ru/dev/webmaster/doc/ru/reference/host-recrawl-post.md>

## 3. OAuth (Yandex ID)

- Register app at <https://oauth.yandex.ru/client/new>. A "web services" app
  with a custom `redirect_uri` is required for a server-side code flow; the
  debug/verification-code app type locks the redirect to
  `https://oauth.yandex.ru/verification_code` and cannot serve multi-user
  flows (app type is immutable once created). Source:
  <https://dev.to/jbobbink/building-a-yandex-seo-mcp-server-six-traps-in-the-yandex-webmaster-api-1bc5> (trap 2).
- Authorize: `GET https://oauth.yandex.ru/authorize?response_type=code&client_id=...&redirect_uri=...&state=...&scope=...`
  — `scope` is **comma-separated**; `code_challenge`/`code_challenge_method=S256`
  (PKCE) supported; code lifetime 10 minutes. Source:
  <https://yandex.com/dev/id/doc/en/codes/code-url.md>
- Token: `POST https://oauth.yandex.ru/token` (form-urlencoded),
  `grant_type=authorization_code` + `code` (+ `client_id`/`client_secret` in
  body; redirect_uri not a documented token param). Response:
  `{ access_token, refresh_token, token_type: "bearer", expires_in, scope? }`.
  `scope` is only returned when fewer rights were granted than requested — a
  usable "scope not granted" check. Sources:
  <https://yandex.com/dev/id/doc/en/codes/code-url.md>,
  <https://yandex.com/dev/id/doc/en/access>
- Refresh: `grant_type=refresh_token` + `refresh_token` (+ client creds).
  **Every refresh returns a new refresh token** (persist it); the access token
  may be returned unchanged if still valid. The refresh token's lifetime
  equals the access token's — **both die together**, so a dead grant requires
  re-consent. Sources:
  <https://yandex.com/dev/id/doc/en/tokens/refresh-client>, trap 4 of the
  dev.to article above.
- Token lifetime: webmaster how-to page says the (implicit-flow) token is
  valid ~6 months; the code-flow `expires_in` is authoritative per response.
  Source: <https://yandex.ru/dev/webmaster/doc/ru/tasks/how-to-get-oauth.md>

## 4. Scopes (the critical trap)

Yandex Webmaster has exactly two API scopes:

- `webmaster:hostinfo` — grants only the **site list**.
- `webmaster:verify` — sounds like a write scope but is required for **every
  data endpoint** (summary, search queries, indexing history, SQI); without it
  they return 403 `ACCESS_FORBIDDEN`.

There is **no read-only scope combination** that returns data. The connect
flow must request both (`webmaster:hostinfo,webmaster:verify`) and the UI/docs
must not promise read-only access. Scope changes are not retroactive —
already-issued tokens keep old scopes and users must reconnect. Source (trap
1): <https://dev.to/jbobbink/building-a-yandex-seo-mcp-server-six-traps-in-the-yandex-webmaster-api-1bc5>;
the two scope names also appear in the official how-to:
<https://yandex.ru/dev/webmaster/doc/ru/tasks/how-to-get-oauth.md>

## 5. Data-availability findings (measured by the dev.to author, Oct 2026)

- The "top-3000 queries of the last week" framing in the docs is incomplete:
  `date_from`/`date_to` windows work (7/28/86-day windows all returned data).
- The API **clamps the end date** — data finalizes ~4 days late (vs Google's
  2–3). Render the range the *response* reports, never the requested one.
- Rows are the top-N **by `order_by`**; sorting a fetched page by another
  column in the UI misleads. MVP fetches ≤ 2 pages (1,000 rows) ordered by the
  user's chosen metric.
- Totals are floors; there is no query-by-page join and no previous-period
  series in the popular-queries endpoint. These limitations are surfaced in
  the UI and MCP tool output as data, not hidden.
- No published rate-limit numbers; keep calls serial (429 contract only).

## 6. Not available / out of scope (verified gaps)

- No read-only data scope (see §4) — documented, communicated in UI/docs.
- No last-crawl time, no per-URL crawl dates in the used endpoints (the GSC
  `inspect_urls` equivalent does not exist; the closest is "important URLs"
  monitoring, deferred).
- No previous-period series, no query→page join in popular queries.
- The popular-queries pool cap (3,000) and per-request cap (500) are hard.
- `YANDEX_SEARCH_API_KEY` (Yandex Search API, used for rank tracking in this
  repo) is a **different product**; Webmaster access is OAuth-only. The two
  configurations must not be mixed.

## 7. Decisions

| Decision | Choice | Rationale | Alternatives rejected |
|---|---|---|---|
| Grant storage | Better Auth `account` rows, providerId `yandex-webmaster`, tokens encrypted with BETTER_AUTH_SECRET | Same table and crypto as Google grants; no new secret management | Separate `yandex_tokens` table (duplicates the account table's purpose); mixing with YANDEX_SEARCH_API_KEY (different product) |
| Grant identity | `user_id` from `GET /v4/user` as `accountId` | Stable per Yandex account; obtainable right after token exchange | login:info OAuth calls (extra scopes for display only) |
| Refresh strategy | Lazy refresh on access (refresh when ≤ 1 day of validity remains), persist rotated refresh token | Matches the GSC pattern; Yandex's refresh returns new refresh tokens so rotation is mandatory | Proactive renewal cron (over-engineering for v1; documented ceiling: a grant unused for its final day expires and asks for reconnect) |
| Date windows offered | `last_7_days`, `last_28_days`, `last_3_months` (≈86d measured OK) | Matches the Search Performance page's existing range set | Arbitrary custom ranges (Yandex clamps anyway) |
| Row fetching | ≤ 2 serial pages of 500 by the chosen `order_by` | Keeps the view fast and serial; the pool cap makes more pages rarely useful | Full 3,000 walk on every page view |
| UI surface | New "Yandex" tab on Search Performance + connect card on Integrations | Reuses the page's tab/range plumbing; one page for search performance | Separate route (duplicates navigation and filters) |
| MCP surface | One read-only tool `get_yandex_search_performance` (queries + summary in one call) | Mirrors `get_search_console_performance`; the summary is one extra cheap call and agents ask for both | Separate summary tool (splits one natural question across two calls) |
| Plugin version | patch bump 1.0.23 → 1.0.24 | AGENTS.md: a new MCP tool requires a bump, all three manifests in sync | No bump (violates AGENTS.md) |
