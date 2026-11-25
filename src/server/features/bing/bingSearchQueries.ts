import { sort } from "remeda";
import type { BingQueryStatsRow } from "@/server/lib/bingWebmasterClient";

// Shared option sets — also drive the server-function Zod schemas so the two
// stay in sync (mirrors yandexSearchQueries, minus the device split Bing does
// not report).

export const BING_DATE_RANGES = [
  "last_7_days",
  "last_28_days",
  "last_3_months",
] as const;

export type BingDateRange = (typeof BING_DATE_RANGES)[number];

export const BING_QUERY_ORDERS = ["clicks", "impressions"] as const;
export type BingQueryOrder = (typeof BING_QUERY_ORDERS)[number];

// Bing refreshes query data weekly, so convenience windows end 4 days back to
// skip the in-progress (partial) week — the same convention Yandex uses.
const BING_DATA_LAG_DAYS = 4;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveBingDateWindow(
  input: {
    dateRange?: BingDateRange;
    startDate?: string;
    endDate?: string;
  },
  today: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  if (input.startDate && input.endDate) {
    return { dateFrom: input.startDate, dateTo: input.endDate };
  }
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() - BING_DATA_LAG_DAYS);
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

// ---------------------------------------------------------------------------
// Aggregation. GetQueryStats returns every weekly bucket Bing has per query;
// the window filter and the per-query rollup happen here.
// ---------------------------------------------------------------------------

export type BingQueryRow = {
  query: string;
  impressions: number | null;
  clicks: number | null;
  avgImpressionPosition: number | null;
  avgClickPosition: number | null;
};

export type BingQueryTotals = {
  clicks: number;
  impressions: number;
  /** Σclicks / Σimpressions, or null when there were no impressions. */
  ctr: number | null;
  /** Impression-weighted mean of the weekly AVG_IMPRESSION_POSITION values, or
   *  null when no bucket reported both values. */
  position: number | null;
};

function sumOrNull(values: Array<number | null>): number | null {
  const present = values.filter((value) => value !== null);
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0)
    : null;
}

/** Roll the weekly buckets up to one row per query. A bucket's average
 *  positions are weighted by its impressions to reconstruct the period's
 *  average — the same construction GSC uses for "Average position". */
export function aggregateBingQueryStats(
  rows: BingQueryStatsRow[],
): BingQueryRow[] {
  const byQuery = new Map<string, BingQueryStatsRow[]>();
  for (const row of rows) {
    const bucket = byQuery.get(row.query);
    if (bucket) bucket.push(row);
    else byQuery.set(row.query, [row]);
  }
  return [...byQuery.entries()].map(([query, buckets]) => {
    const impressions = sumOrNull(buckets.map((b) => b.impressions));
    const clicks = sumOrNull(buckets.map((b) => b.clicks));
    return {
      query,
      impressions,
      clicks,
      avgImpressionPosition: averagePosition(
        buckets.map((b) => [b.avgImpressionPosition, b.impressions] as const),
      ),
      avgClickPosition: averagePosition(
        buckets.map((b) => [b.avgClickPosition, b.impressions] as const),
      ),
    };
  });
}

function averagePosition(
  pairs: ReadonlyArray<readonly [number | null, number | null]>,
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const [position, impressions] of pairs) {
    const weightHere = impressions ?? 0;
    if (position === null || weightHere <= 0) continue;
    weighted += position * weightHere;
    weight += weightHere;
  }
  return weight > 0 ? weighted / weight : null;
}

/** Site-level totals for the metric cards, aggregated over the given rows. */
export function sumBingQueryTotals(rows: BingQueryRow[]): BingQueryTotals {
  let clicks = 0;
  let impressions = 0;
  let weightedSum = 0;
  let positionWeight = 0;
  for (const row of rows) {
    const rowImpressions = row.impressions ?? 0;
    clicks += row.clicks ?? 0;
    impressions += rowImpressions;
    if (row.avgImpressionPosition !== null && rowImpressions > 0) {
      weightedSum += row.avgImpressionPosition * rowImpressions;
      positionWeight += rowImpressions;
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: positionWeight > 0 ? weightedSum / positionWeight : null,
  };
}

/** Previous-window totals over the SAME query set as the current window. */
export function sumBingPreviousTotals(
  currentRows: BingQueryRow[],
  previousRows: BingQueryRow[],
): { totals: BingQueryTotals; matchedQueryCount: number } {
  const currentQueries = new Set(currentRows.map((row) => row.query));
  const matched = previousRows.filter((row) => currentQueries.has(row.query));
  return {
    totals: sumBingQueryTotals(matched),
    matchedQueryCount: matched.length,
  };
}

export function orderBingQueryRows(
  rows: BingQueryRow[],
  orderBy: BingQueryOrder,
): BingQueryRow[] {
  const key = (row: BingQueryRow) => row[orderBy] ?? 0;
  // Remeda's sort copies, so the caller's array is left as fetched.
  return sort(rows, (a, b) => key(b) - key(a));
}
