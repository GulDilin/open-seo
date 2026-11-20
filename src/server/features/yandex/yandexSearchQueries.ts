import type {
  YandexDeviceType,
  YandexQueryOrderBy,
  YandexQueryRow,
} from "@/server/lib/yandexWebmasterClient";

// Shared option sets — also drive the MCP tool Zod schemas so the two stay in
// sync (mirrors gsc/searchAnalytics.ts).

export const YANDEX_DATE_RANGES = [
  "last_7_days",
  "last_28_days",
  "last_3_months",
] as const;

export type YandexDateRange = (typeof YANDEX_DATE_RANGES)[number];

/** Internal orderBy names, mapped to Yandex's TOTAL_SHOWS/TOTAL_CLICKS at the
 *  adapter boundary. */
export const YANDEX_QUERY_ORDERS = ["clicks", "impressions"] as const;
export type YandexQueryOrder = (typeof YANDEX_QUERY_ORDERS)[number];

export const YANDEX_DEVICE_TYPES = [
  "all",
  "desktop",
  "mobile_and_tablet",
] as const;
export type YandexDeviceTypeOption = (typeof YANDEX_DEVICE_TYPES)[number];

/** Yandex hard caps one page at 500 rows and the whole pool at 3,000. */
export const YANDEX_PAGE_LIMIT = 500;
/** The view fetches at most two serial pages (1,000 rows) per request. */
export const YANDEX_MAX_ROWS = 1000;
export const YANDEX_DEFAULT_ROWS = 500;
// Yandex finalizes query data ~4 days late (measured; the docs only say "last
// week" by default), so convenience windows end 4 days back.
const YANDEX_DATA_LAG_DAYS = 4;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveYandexDateWindow(
  input: {
    dateRange?: YandexDateRange;
    startDate?: string;
    endDate?: string;
  },
  today: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  if (input.startDate && input.endDate) {
    return { dateFrom: input.startDate, dateTo: input.endDate };
  }
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() - YANDEX_DATA_LAG_DAYS);
  const from = new Date(to);
  switch (input.dateRange ?? "last_28_days") {
    case "last_7_days":
      from.setUTCDate(from.getUTCDate() - 6);
      break;
    case "last_28_days":
      from.setUTCDate(from.getUTCDate() - 27);
      break;
    case "last_3_months":
      from.setUTCDate(from.getUTCDate() - 85);
      break;
  }
  return { dateFrom: formatDate(from), dateTo: formatDate(to) };
}

export function toWireOrderBy(order: YandexQueryOrder): YandexQueryOrderBy {
  return order === "clicks" ? "TOTAL_CLICKS" : "TOTAL_SHOWS";
}

export function toWireDeviceType(
  device: YandexDeviceTypeOption,
): YandexDeviceType {
  return device === "all"
    ? "ALL"
    : device === "desktop"
      ? "DESKTOP"
      : "MOBILE_AND_TABLET";
}

// ---------------------------------------------------------------------------
// Totals aggregation (Google-parity metric cards).
// ---------------------------------------------------------------------------

export type YandexQueryTotals = {
  clicks: number;
  impressions: number;
  /** Σclicks / Σimpressions, or null when there were no impressions. */
  ctr: number | null;
  /** Impression-weighted mean of per-query AVG_SHOW_POSITION, or null when no
   *  query reported both values. */
  position: number | null;
};

/** Aggregate popular-query rows into site-level totals for the metric cards.
 *
 *  Yandex reports per query (v4 docs): TOTAL_SHOWS/TOTAL_CLICKS are the
 *  query's impression/click counts for the window, AVG_SHOW_POSITION its
 *  average impression position. So:
 *  - clicks/impressions are plain sums over the loaded queries;
 *  - CTR is derived (Σclicks / Σimpressions) — Yandex does not report it;
 *  - position = Σ(AVG_SHOW_POSITION × shows) / Σ(shows), the impression-
 *    weighted mean. Weighting each query's average by its impressions
 *    reconstructs the site-wide average show position over the loaded
 *    queries — the same construction GSC uses for "Average position".
 *  Null indicators (Yandex omits values it has not computed) contribute 0 to
 *  the sums and are skipped from the position weights. Totals cover only the
 *  loaded top queries, so they are lower bounds, not site-wide reports. */
export function sumYandexQueryTotals(
  rows: YandexQueryRow[],
): YandexQueryTotals {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  let positionWeight = 0;
  for (const row of rows) {
    const rowImpressions = row.impressions ?? 0;
    clicks += row.clicks ?? 0;
    impressions += rowImpressions;
    if (row.avgShowPosition !== null && rowImpressions > 0) {
      weightedPosition += row.avgShowPosition * rowImpressions;
      positionWeight += rowImpressions;
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: positionWeight > 0 ? weightedPosition / positionWeight : null,
  };
}

/** Previous-window totals over the SAME query set as the current window
 *  (matched by query text). Current queries the previous window did not
 *  return weren't in its top either, so they contribute zero — which slightly
 *  understates the previous period and inflates growth. */
export function sumYandexPreviousTotals(
  currentRows: YandexQueryRow[],
  previousRows: YandexQueryRow[],
): { totals: YandexQueryTotals; matchedQueryCount: number } {
  const currentQueries = new Set(currentRows.map((row) => row.query));
  const matched = previousRows.filter((row) => currentQueries.has(row.query));
  return {
    totals: sumYandexQueryTotals(matched),
    matchedQueryCount: matched.length,
  };
}
