import type {
  YandexDeviceType,
  YandexQueryOrderBy,
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
