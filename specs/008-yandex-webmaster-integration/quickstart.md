# Quickstart: validate the Yandex Webmaster integration

Prerequisites: a Yandex account with at least one **verified** site in Yandex
Webmaster (<https://webmaster.yandex.ru>) that has organic Yandex search
traffic. Without live keys only the unit checks below run — live steps are
marked **AT INTEGRATION**.

## Setup (AT INTEGRATION — needs a real Yandex OAuth app)

1. Register a "web services" app at <https://oauth.yandex.ru/client/new>;
   enable the `webmaster:hostinfo` and `webmaster:verify` permissions and add
   `http://localhost:3000/api/yandex/oauth/callback` (and your public origin)
   as redirect URIs. App type is immutable — do not pick the debug type.
2. `cp .env.example .env` and set `YANDEX_OAUTH_CLIENT_ID` /
   `YANDEX_OAUTH_CLIENT_SECRET` (+ `BETTER_AUTH_SECRET`, already required).
3. `pnpm dev`, open a project → Settings → Integrations → the Yandex
   Webmaster card shows "Not connected" (or "Setup required" if step 2 is
   incomplete).

## End-to-end checks

| # | Scenario | Expected |
|---|---|---|
| 1 | Startup with no YANDEX_OAUTH_* env | preflight lists "Yandex Webmaster (OAuth)" as optional/not configured (US4) |
| 2 | Only one of the two env vars set | preflight warns both are required (US4) |
| 3 | Connect from the card | redirect to Yandex consent, return to Integrations, site picker lists the account's sites; unverified sites not selectable (US1) |
| 4 | Pick a site | card shows connected host; Search Performance → Yandex tab shows summary (SQI, pages in search, excluded, problems, indexing status) and the queries table (US2) |
| 5 | Change range to last 7 days / last 3 months | table reloads; the caption shows the window Yandex reports, which may be shorter than requested (US2) |
| 6 | Connect a brand-new verified site with no traffic | Yandex tab explains Yandex has no data for the period — no fake zeros (US2) |
| 7 | Disconnect | card returns to Not connected; Yandex tab shows the connect state; MCP tool answers `not_connected` with a connectUrl (US1/US3) |
| 8 | Revoke the app at oauth.yandex.ru → refresh the tab | reconnect prompt, not a generic error (US1) |
| 9 | MCP: call `get_yandex_search_performance` with the project id | queries + summary + limitations note; no credits used (US3) |

## Unit checks (no keys needed)

```
pnpm exec vitest run src/server/features/yandex src/server/lib/yandexWebmasterClient.test.ts
```

Fixtures in tests embed Yandex's documented response examples (uid, hosts,
popular queries, summary) and are annotated `AT INTEGRATION` — when live keys
exist, replay the four endpoints and compare field-by-field.
