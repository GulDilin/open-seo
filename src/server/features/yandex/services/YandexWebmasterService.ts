import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import { createYandexWebmasterClient } from "@/server/lib/yandexWebmasterClient";
import {
  YandexWebmasterApiError,
  YandexWebmasterNotConnectedError,
  YandexWebmasterTokenError,
} from "@/server/lib/yandexWebmasterErrors";
export { YandexWebmasterNotConnectedError } from "@/server/lib/yandexWebmasterErrors";
import { YANDEX_WEBMASTER_PROVIDER_ID } from "@/shared/yandex-webmaster";
import { YandexConnectionRepository } from "@/server/features/yandex/repositories/YandexConnectionRepository";
import { previousPeriod } from "@/server/features/gsc/searchPerformanceReport";
import {
  resolveYandexDateWindow,
  sumYandexPreviousTotals,
  sumYandexQueryTotals,
  toWireDeviceType,
  toWireOrderBy,
  YANDEX_DEFAULT_ROWS,
  YANDEX_MAX_ROWS,
  YANDEX_PAGE_LIMIT,
  type YandexDateRange,
  type YandexDeviceTypeOption,
  type YandexQueryOrder,
  type YandexQueryTotals,
} from "@/server/features/yandex/yandexSearchQueries";
import type {
  YandexDeviceType,
  YandexHost,
  YandexPopularQueries,
  YandexQueryOrderBy,
  YandexQueryRow,
  YandexSiteSummary,
} from "@/server/lib/yandexWebmasterClient";

type YandexSiteListResult = {
  accounts: Array<{
    accountId: string;
    requiresReconnect: boolean;
    sitesUnavailable: boolean;
    sites: YandexHost[];
  }>;
};

/** Thrown when a project has no connected Yandex Webmaster site. */
async function getConnection(projectId: string) {
  return YandexConnectionRepository.getByProjectId(projectId);
}

/** Whether this user linked a yandex-webmaster grant (regardless of whether a
 *  site is picked yet). Drives the connect-vs-pick UI. */
async function userHasGrant(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, YANDEX_WEBMASTER_PROVIDER_ID),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function listGrantsForUser(userId: string) {
  return db
    .select({ id: account.id, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, YANDEX_WEBMASTER_PROVIDER_ID),
      ),
    );
}

/** Expected ways a stored grant fails to reach the Webmaster API: no token
 *  could be minted (refresh dead — Yandex kills it with the access token), or
 *  Yandex rejected the call (401/403). These surface a reconnect prompt
 *  without fault logging. */
export function isExpectedGrantFailure(error: unknown): boolean {
  if (error instanceof YandexWebmasterTokenError) return true;
  return (
    error instanceof YandexWebmasterApiError &&
    (error.status === 401 || error.status === 403)
  );
}

async function listSitesForUserWithGrantStatus(
  userId: string,
): Promise<YandexSiteListResult> {
  const grants = await listGrantsForUser(userId);
  const accounts = await Promise.all(
    grants.map(async (grant) => {
      const client = createYandexWebmasterClient({
        userId,
        yandexAccountId: grant.accountId,
      });
      try {
        const sites = await client.listHosts();
        return {
          accountId: grant.accountId,
          requiresReconnect: false,
          sitesUnavailable: false,
          sites,
        };
      } catch (error) {
        if (!isExpectedGrantFailure(error)) {
          console.error(
            "Failed to list Yandex Webmaster sites for account",
            grant.accountId,
            error,
          );
        }
        return {
          accountId: grant.accountId,
          requiresReconnect: isExpectedGrantFailure(error),
          sitesUnavailable: !isExpectedGrantFailure(error),
          sites: [],
        };
      }
    }),
  );
  return { accounts };
}

/** Map a verified Yandex site to a project. Rejects unverified sites and
 *  sites not present on the connector's grant. */
async function setSite(input: {
  projectId: string;
  organizationId: string;
  accountId: string;
  hostId: string;
  userId: string;
}) {
  const grants = await listGrantsForUser(input.userId);
  if (!grants.some((grant) => grant.accountId === input.accountId)) {
    throw new AppError(
      "NOT_FOUND",
      "That Yandex account isn't connected to your OpenSEO account.",
    );
  }
  const client = createYandexWebmasterClient({
    userId: input.userId,
    yandexAccountId: input.accountId,
  });
  const sites = await client.listHosts();
  const match = sites.find((site) => site.hostId === input.hostId);
  if (!match) {
    throw new AppError(
      "NOT_FOUND",
      "That site isn't available in the connected Yandex Webmaster account.",
    );
  }
  if (!match.verified) {
    throw new AppError(
      "FORBIDDEN",
      "That site isn't verified in Yandex Webmaster. Confirm ownership in Yandex first.",
    );
  }
  return YandexConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    hostId: match.hostId,
    hostUrl: match.asciiHostUrl,
    connectedByUserId: input.userId,
    yandexAccountId: input.accountId,
  });
}

async function disconnect(input: { projectId: string }): Promise<void> {
  await YandexConnectionRepository.deleteByProjectId(input.projectId);
}

type YandexSearchPerformanceResult = {
  hostUrl: string;
  orderBy: YandexQueryOrder;
  deviceType: YandexDeviceTypeOption;
  // The window Yandex actually returned — it may be shorter than requested.
  reportedDateFrom: string;
  reportedDateTo: string;
  // Yandex's count of queries available in the capped pool (≤ 3000).
  totalCount: number;
  rows: YandexQueryRow[];
  // Aggregates of the loaded rows — Google-parity metric cards. Lower bounds:
  // they cover only the loaded top queries, not the whole site.
  totals: YandexQueryTotals;
  // Previous-window comparison over the same queries; null when there were no
  // rows to compare or the previous-window fetch failed (changeError says why).
  change: {
    dateFrom: string;
    dateTo: string;
    totals: YandexQueryTotals;
    // How many of the loaded queries the previous window also returned.
    matchedQueryCount: number;
  } | null;
  changeError: string | null;
  summary: YandexSiteSummary | null;
  // Why the summary is missing when it is — shown instead of silent nulls.
  summaryError: string | null;
  indexingStatus: string | null;
};

/** Fetch up to `wanted` popular-query rows as serial 500-row pages, stopping
 *  on a short page (Yandex has no published rate limits). */
async function fetchQueryPages(
  client: ReturnType<typeof createYandexWebmasterClient>,
  hostId: string,
  input: {
    orderBy: YandexQueryOrderBy;
    deviceType: YandexDeviceType;
    dateFrom: string;
    dateTo: string;
    wanted: number;
  },
): Promise<YandexPopularQueries> {
  const first = await client.getPopularQueries(hostId, {
    orderBy: input.orderBy,
    deviceType: input.deviceType,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    limit: Math.min(input.wanted, YANDEX_PAGE_LIMIT),
    offset: 0,
  });
  const rows = [...first.rows];
  if (rows.length >= YANDEX_PAGE_LIMIT && input.wanted > YANDEX_PAGE_LIMIT) {
    const second = await client.getPopularQueries(hostId, {
      orderBy: input.orderBy,
      deviceType: input.deviceType,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      limit: input.wanted - rows.length,
      offset: rows.length,
    });
    rows.push(...second.rows);
  }
  return { ...first, rows };
}

/** The Yandex tab / MCP tool payload: popular queries for the window plus the
 *  site summary and the previous-window comparison. Summary, host info, and
 *  the change are best-effort — a brand-new site has neither, and queries are
 *  the point. */
async function getSearchPerformance(input: {
  projectId: string;
  dateRange?: YandexDateRange;
  startDate?: string;
  endDate?: string;
  orderBy?: YandexQueryOrder;
  deviceType?: YandexDeviceTypeOption;
  limit?: number;
  /** Skip the previous-window comparison. Consumers that only need the query
   *  rows (keyword auto-import) avoid doubling the popular-queries pages. */
  includeChange?: boolean;
}): Promise<YandexSearchPerformanceResult> {
  const connection = await YandexConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) {
    throw new YandexWebmasterNotConnectedError(input.projectId);
  }
  const orderBy = input.orderBy ?? "clicks";
  const deviceType = input.deviceType ?? "all";
  const wanted = Math.max(
    1,
    Math.min(input.limit ?? YANDEX_DEFAULT_ROWS, YANDEX_MAX_ROWS),
  );
  const { dateFrom, dateTo } = resolveYandexDateWindow(input);
  const client = createYandexWebmasterClient({
    userId: connection.connectedByUserId,
    yandexAccountId: connection.yandexAccountId ?? undefined,
  });
  const queryInput = {
    orderBy: toWireOrderBy(orderBy),
    deviceType: toWireDeviceType(deviceType),
    wanted,
  };

  const current = await fetchQueryPages(client, connection.hostId, {
    ...queryInput,
    dateFrom,
    dateTo,
  });

  // The change compares the previous same-length window over the same
  // queries. The reported window is shifted (not the requested one) so a site
  // with clamped history compares like-for-like windows. Best-effort: a
  // failure degrades the Change column, not the whole section.
  const [summary, hostInfo, previous] = await Promise.allSettled([
    client.getSummary(connection.hostId),
    client.getHostInfo(connection.hostId),
    current.rows.length > 0 && input.includeChange !== false
      ? (async () => {
          const window = previousPeriod(
            current.reportedDateFrom,
            current.reportedDateTo,
          );
          const previousRows = await fetchQueryPages(
            client,
            connection.hostId,
            {
              ...queryInput,
              dateFrom: window.startDate,
              dateTo: window.endDate,
            },
          );
          return {
            window,
            ...sumYandexPreviousTotals(current.rows, previousRows.rows),
          };
        })()
      : Promise.resolve(null),
  ]);

  return {
    hostUrl: connection.hostUrl,
    orderBy,
    deviceType,
    reportedDateFrom: current.reportedDateFrom,
    reportedDateTo: current.reportedDateTo,
    totalCount: current.totalCount,
    rows: current.rows,
    totals: sumYandexQueryTotals(current.rows),
    change:
      previous.status === "fulfilled" && previous.value
        ? {
            dateFrom: previous.value.window.startDate,
            dateTo: previous.value.window.endDate,
            totals: previous.value.totals,
            matchedQueryCount: previous.value.matchedQueryCount,
          }
        : null,
    changeError:
      previous.status === "rejected"
        ? previous.reason instanceof Error
          ? previous.reason.message
          : String(previous.reason)
        : null,
    summary: summary.status === "fulfilled" ? summary.value : null,
    summaryError:
      summary.status === "rejected"
        ? summary.reason instanceof Error
          ? summary.reason.message
          : String(summary.reason)
        : null,
    indexingStatus:
      hostInfo.status === "fulfilled" ? hostInfo.value.indexingStatus : null,
  };
}

export const YandexWebmasterService = {
  getConnection,
  userHasGrant,
  listSitesForUserWithGrantStatus,
  setSite,
  disconnect,
  getSearchPerformance,
};
