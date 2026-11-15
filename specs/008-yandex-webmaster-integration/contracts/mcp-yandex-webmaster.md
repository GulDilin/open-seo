# Contract: MCP tool `get_yandex_search_performance`

Read-only, credit-free, project-scoped (same auth wrapper as
`get_search_console_performance`). Registered in `src/server/mcp/server.ts`;
output schema `yandexWebmasterSchema` in `src/shared/mcp-contracts.ts`.

## Input (Zod)

| Field | Type | Default | Description |
|---|---|---|---|
| `projectId` | string | — | project the caller's workspace owns |
| `dateRange` | `last_7_days` \| `last_28_days` \| `last_3_months` | `last_28_days` | convenience window; end set 4 days back for Yandex finalization lag. Ignored when dateFrom+dateTo given |
| `dateFrom` / `dateTo` | `YYYY-MM-DD` | — | explicit window (both or neither) |
| `orderBy` | `impressions` \| `clicks` | `clicks` | maps to Yandex `TOTAL_SHOWS`/`TOTAL_CLICKS`; rows are the top-N by this metric |
| `deviceType` | `all` \| `desktop` \| `mobile_and_tablet` | `all` | maps to `device_type_indicator` |
| `limit` | int 1–1000 | 500 | rows returned (fetched ≤ 500 per API page, serially) |

## Output (structuredContent, all Zod-validated)

```
ok: boolean
hostUrl: string                 # ascii_host_url of the connected site
reportedDateFrom / reportedDateTo: string   # window Yandex ACTUALLY returned (may be shorter than requested)
orderBy / deviceType: echo
totalCount: number              # Yandex `count` — size of the capped pool (≤ 3000)
rowCount: number
rows: Array<{ query: string, impressions: number, clicks: number, ctr: number, avgShowPosition?: number, avgClickPosition?: number }>
summary?: { sqi?, searchablePagesCount?, excludedPagesCount?, problems?: { fatal?, critical?, possibleProblem?, recommendation? }, indexingStatus?: "NOT_INDEXED"|"NOT_LOADED"|"OK" }
limitations: string[]           # honest notes: totals are floors, no query-page join, no previous period, CTR derived
# failure: ok=false with reason: "yandex_oauth_not_configured" | "not_connected" | "needs_reconnect" | "api_error" | "invalid_request", connectUrl / setupDocsUrl where useful
```

## Text rendering

Header line `hostUrl · reported window · N queries (of M available) · ordered by X`
followed by an MCP table (query, impressions, clicks, CTR, avg position), the
summary as labeled lines, and the limitations as a trailing note block.

## Server functions (app surface)

Same shapes minus MCP meta, exposed as TanStack server functions in
`src/serverFunctions/yandexWebmaster.ts`: `getYandexConnection`,
`listYandexSites`, `setYandexSite`, `disconnectYandex`, `startYandexLink`,
`getYandexSearchPerformance` (queries + summary for the tab). All
project-scoped via `requireProjectContext`; `setYandexSite`/`disconnectYandex`
additionally require the `integration:manage` org permission.
