import { AppError } from "@/server/lib/errors";
import { createBingWebmasterClient } from "@/server/lib/bingWebmasterClient";
import {
  BingWebmasterApiError,
  BingWebmasterNotConnectedError,
  BingWebmasterTokenError,
} from "@/server/lib/bingWebmasterErrors";
import { getSecretCrypto } from "@/server/lib/secretCrypto";
import { WebmasterBacklinksRepository } from "@/server/features/backlinks/repositories/WebmasterBacklinksRepository";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { previousPeriod } from "@/server/features/gsc/searchPerformanceReport";
import {
  aggregateBingQueryStats,
  orderBingQueryRows,
  resolveBingDateWindow,
  sumBingPreviousTotals,
  sumBingQueryTotals,
  type BingDateRange,
  type BingQueryOrder,
  type BingQueryRow,
  type BingQueryTotals,
} from "@/server/features/bing/bingSearchQueries";
import type {
  BingLinkCounts,
  BingSite,
} from "@/server/lib/bingWebmasterClient";

// ---------------------------------------------------------------------------
// Connection management. Bing authenticates with the user's static API key, so
// "connect" is: enter the key, pick one of the sites that key can see.
// ---------------------------------------------------------------------------

/** Sites visible to the key the user just typed — the connect card's list.
 *  Confirms the key works before anything is stored. */
async function listSitesForApiKey(apiKey: string): Promise<BingSite[]> {
  return createBingWebmasterClient({ apiKey }).getUserSites();
}

/** Sites visible to the given key, or to the project's stored key when none is
 *  given (the change-site flow reuses what was already connected). */
async function listSites(input: {
  projectId: string;
  apiKey?: string;
}): Promise<BingSite[]> {
  if (input.apiKey) return listSitesForApiKey(input.apiKey);
  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) {
    throw new BingWebmasterNotConnectedError(input.projectId);
  }
  return (await openClient(connection)).getUserSites();
}

/** Map one Bing site to a project, storing the key it was listed with — the
 *  one the user typed, or the project's stored key when none was given
 *  (change-site). */
async function setSite(input: {
  projectId: string;
  organizationId: string;
  apiKey?: string;
  siteUrl: string;
  userId: string;
}) {
  const sites = await listSites({
    projectId: input.projectId,
    apiKey: input.apiKey,
  });
  const match = sites.find((site) => site.siteUrl === input.siteUrl);
  if (!match) {
    throw new AppError(
      "NOT_FOUND",
      "That site isn't available on the Bing Webmaster account behind that API key.",
    );
  }
  if (!match.verified) {
    throw new AppError(
      "FORBIDDEN",
      "That site isn't verified in Bing Webmaster. Confirm ownership in Bing first.",
    );
  }
  // A key the user just typed is stored encrypted; otherwise the change-site
  // flow keeps the key already stored for this project.
  const stored = await BingConnectionRepository.getByProjectId(input.projectId);
  const apiKey = input.apiKey
    ? await (await getSecretCrypto()).encrypt(input.apiKey)
    : stored?.apiKey;
  if (!apiKey) {
    throw new BingWebmasterNotConnectedError(input.projectId);
  }
  return BingConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    siteUrl: match.siteUrl,
    apiKey,
    connectedByUserId: input.userId,
  });
}

async function disconnect(input: { projectId: string }): Promise<void> {
  await BingConnectionRepository.deleteByProjectId(input.projectId);
}

/** Expected ways the stored key fails to reach the Bing Webmaster API: the key
 *  could not be decrypted, or Bing rejected it — HTTP 400 with Message
 *  "InvalidApiKey" (ErrorCode 3) is how Bing reports a dead key. These surface
 *  a reconnect prompt without fault logging. */
export function isExpectedAuthFailure(error: unknown): boolean {
  if (error instanceof BingWebmasterTokenError) return true;
  if (!(error instanceof BingWebmasterApiError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  // The documented body is {"ErrorCode":3,"Message":"InvalidApiKey"}; spacing
  // and casing vary across error bodies, so compare the letters only.
  return (
    error.errorCode === 3 ||
    /invalidapikey/i.test(error.message.replace(/[^a-z]/gi, ""))
  );
}

async function openClient(connection: { apiKey: string }) {
  try {
    const apiKey = await (await getSecretCrypto()).decrypt(connection.apiKey);
    return createBingWebmasterClient({ apiKey });
  } catch (error) {
    throw new BingWebmasterTokenError(
      "Could not decrypt the stored Bing Webmaster API key. Reconnect Bing Webmaster.",
      error,
    );
  }
}

async function getConnection(projectId: string) {
  return BingConnectionRepository.getByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Search queries (GetQueryStats).
// ---------------------------------------------------------------------------

type BingSearchPerformanceResult = {
  siteUrl: string;
  orderBy: BingQueryOrder;
  // The window the rows were filtered to.
  dateFrom: string;
  dateTo: string;
  // First and last weekly bucket Bing reported — may extend beyond the window.
  reportedDateFrom: string | null;
  reportedDateTo: string | null;
  rows: BingQueryRow[];
  totals: BingQueryTotals;
  // Previous-window comparison over the same queries, computed from buckets
  // Bing already returned (no extra API call).
  change: {
    dateFrom: string;
    dateTo: string;
    totals: BingQueryTotals;
    matchedQueryCount: number;
  } | null;
};

/** The Bing performance page payload: per-query totals for the window, rolled
 *  up from the weekly buckets GetQueryStats returns (Bing exposes no date
 *  parameters, so everything is windowed here). */
async function getSearchPerformance(input: {
  projectId: string;
  dateRange?: BingDateRange;
  startDate?: string;
  endDate?: string;
  orderBy?: BingQueryOrder;
}): Promise<BingSearchPerformanceResult> {
  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) {
    throw new BingWebmasterNotConnectedError(input.projectId);
  }
  const orderBy = input.orderBy ?? "clicks";
  const { dateFrom, dateTo } = resolveBingDateWindow(input);
  const client = await openClient(connection);
  const stats = await client.getQueryStats(connection.siteUrl);

  const rows = aggregateBingQueryStats(
    stats.rows.filter((row) => row.date >= dateFrom && row.date <= dateTo),
  );
  const ordered = orderBingQueryRows(rows, orderBy);

  // The comparison window mirrors the previous same-length period ending right
  // before the requested one. Buckets Bing already returned fill it, so no
  // extra API call is needed.
  const changeWindow = previousPeriod(dateFrom, dateTo);
  const previousRows = aggregateBingQueryStats(
    stats.rows.filter(
      (row) =>
        row.date >= changeWindow.startDate && row.date <= changeWindow.endDate,
    ),
  );
  const change =
    ordered.length > 0 && previousRows.length > 0
      ? {
          dateFrom: changeWindow.startDate,
          dateTo: changeWindow.endDate,
          ...sumBingPreviousTotals(ordered, previousRows),
        }
      : null;

  return {
    siteUrl: connection.siteUrl,
    orderBy,
    dateFrom,
    dateTo,
    reportedDateFrom: stats.reportedDateFrom,
    reportedDateTo: stats.reportedDateTo,
    rows: ordered,
    totals: sumBingQueryTotals(ordered),
    change,
  };
}

// ---------------------------------------------------------------------------
// External links (GetLinkCounts + GetUrlLinks), stored in the shared
// webmaster_backlink_* tables under source "bing_webmaster".
// ---------------------------------------------------------------------------

// Bing pages its reports; the page size is not documented. Six pages of linked
// URLs balance API load against a useful overview; `TotalPages` (Bing's count)
// is surfaced so the UI can say more is available in Bing Webmaster.
const LINK_COUNTS_MAX_PAGES = 6;
// GetUrlLinks is one request per target URL — sample a handful of the top
// pages rather than walking the whole linked-page list.
const SAMPLE_TARGET_URLS = 5;
const SAMPLES_PAGE_LIMIT = 100;

// Re-collect at most twice a day; reads in between are served from storage.
const COLLECT_TTL_MS = 12 * 60 * 60 * 1000;

// The half of the payload that is read live from Bing rather than persisted.
type LinkCountsPart = Pick<
  BingBacklinksResult,
  "linkCounts" | "loadedLinksTotal" | "totalPages" | "linkCountsTruncated"
>;

const EMPTY_LINK_COUNTS: LinkCountsPart = {
  linkCounts: [],
  loadedLinksTotal: 0,
  totalPages: null,
  linkCountsTruncated: false,
};

type BingBacklinksResult = {
  connected: boolean;
  siteUrl: string | null;
  // Why live data is missing when it is — a dead key etc. Rendered instead of
  // silent zeros.
  unavailableReason: string | null;
  // Per-page inbound-link counts (Bing reports no site-wide link total).
  linkCounts: Array<{ url: string; count: number }>;
  loadedLinksTotal: number;
  // Bing's TotalPages for the site's linked pages; loaded pages are a subset.
  totalPages: number | null;
  linkCountsTruncated: boolean;
  samples: Array<{
    sourceUrl: string;
    destinationUrl: string;
    anchorText: string | null;
  }>;
  storedSamplesCount: number;
  lastCollectedAt: string | null;
  // Why a collect attempt failed, when stored data may be stale.
  collectError: string | null;
};

function emptyLinksPart(
  overrides: Partial<
    Pick<BingBacklinksResult, "connected" | "siteUrl" | "unavailableReason">
  > = {},
): BingBacklinksResult {
  return {
    connected: false,
    siteUrl: null,
    unavailableReason: null,
    linkCounts: [],
    loadedLinksTotal: 0,
    totalPages: null,
    linkCountsTruncated: false,
    samples: [],
    storedSamplesCount: 0,
    lastCollectedAt: null,
    collectError: null,
    ...overrides,
  };
}

/** Read the site's inbound-link counts (GetLinkCounts, up to
 *  LINK_COUNTS_MAX_PAGES pages, stopping on an empty one). The shared
 *  webmaster tables have no per-URL home for these, so they are read live on
 *  every page load rather than persisted. */
async function collectLinkCounts(
  client: ReturnType<typeof createBingWebmasterClient>,
  siteUrl: string,
): Promise<LinkCountsPart> {
  let linkCounts: BingLinkCounts["links"] = [];
  let totalPages: number | null = null;
  for (let page = 0; page < LINK_COUNTS_MAX_PAGES; page += 1) {
    const result = await client.getLinkCounts(siteUrl, page);
    linkCounts = [...linkCounts, ...result.links];
    totalPages = result.totalPages ?? totalPages;
    if (result.links.length === 0) break;
  }
  return {
    linkCounts,
    loadedLinksTotal: linkCounts.reduce((sum, link) => sum + link.count, 0),
    totalPages,
    linkCountsTruncated:
      totalPages !== null && totalPages > LINK_COUNTS_MAX_PAGES,
  };
}

/** Pull sample links (GetUrlLinks for the top target URLs of the counts just
 *  read) and persist them with a snapshot row — the snapshot's capturedAt is
 *  what the TTL keys on. Bing reports no discovery dates, so stored samples
 *  carry none. Returns the fresh samples (with anchor text). */
async function collectStoredSamples(
  client: ReturnType<typeof createBingWebmasterClient>,
  input: {
    projectId: string;
    siteUrl: string;
    linkCounts: BingLinkCounts["links"];
    loadedLinksTotal: number;
  },
): Promise<BingBacklinksResult["samples"]> {
  const capturedAt = new Date().toISOString();
  const samples: BingBacklinksResult["samples"] = [];
  const seen = new Set<string>();
  for (const target of input.linkCounts.slice(0, SAMPLE_TARGET_URLS)) {
    const details = await client.getUrlLinks(input.siteUrl, target.url, 0);
    for (const detail of details.details) {
      const key = `${detail.sourceUrl}|${target.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push({
        sourceUrl: detail.sourceUrl,
        destinationUrl: target.url,
        anchorText: detail.anchorText,
      });
    }
  }

  await WebmasterBacklinksRepository.saveSnapshots([
    {
      projectId: input.projectId,
      source: "bing_webmaster",
      date: capturedAt.slice(0, 10),
      // Bing reports no site-wide link total; the snapshot keeps the sum over
      // the pages loaded this collect.
      linksTotalCount: input.loadedLinksTotal,
      capturedAt,
    },
  ]);
  if (samples.length > 0) {
    await WebmasterBacklinksRepository.saveSamples(
      samples.map((sample) => ({
        projectId: input.projectId,
        source: "bing_webmaster" as const,
        sourceUrl: sample.sourceUrl,
        destinationUrl: sample.destinationUrl,
        discoveryDate: null,
        sourceLastAccessDate: null,
        seenAt: capturedAt,
      })),
    );
  }
  return samples;
}

/** The Bing links page payload: live link counts plus stored samples, with the
 *  stored half refreshed from Bing when it is older than the TTL. Collect
 *  failures never throw — a dead key degrades to unavailableReason, anything
 *  else to collectError over whatever is already stored. */
async function getLinks(input: {
  projectId: string;
}): Promise<BingBacklinksResult> {
  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) {
    return emptyLinksPart();
  }

  let unavailableReason: string | null = null;
  let collectError: string | null = null;
  const noteCollectFailure = (error: unknown) => {
    if (isExpectedAuthFailure(error)) {
      unavailableReason =
        error instanceof Error ? error.message : String(error);
    } else {
      collectError = error instanceof Error ? error.message : String(error);
      console.error("bing_webmaster_links_collect_failed", {
        projectId: input.projectId,
        reason: collectError,
      });
    }
  };

  let counts = EMPTY_LINK_COUNTS;
  let freshSamples: BingBacklinksResult["samples"] | null = null;
  try {
    const client = await openClient(connection);
    counts = await collectLinkCounts(client, connection.siteUrl);
    const lastCollected = await WebmasterBacklinksRepository.lastCollectedAt(
      input.projectId,
      "bing_webmaster",
    );
    const stale =
      lastCollected === null ||
      Date.now() - Date.parse(lastCollected) > COLLECT_TTL_MS;
    if (stale) {
      freshSamples = await collectStoredSamples(client, {
        projectId: input.projectId,
        siteUrl: connection.siteUrl,
        linkCounts: counts.linkCounts,
        loadedLinksTotal: counts.loadedLinksTotal,
      });
    }
  } catch (error) {
    noteCollectFailure(error);
  }

  // A dead key surfaces as disconnected even if older data exists — the
  // numbers would silently stop moving otherwise.
  if (unavailableReason !== null) {
    return emptyLinksPart({
      siteUrl: connection.siteUrl,
      unavailableReason,
    });
  }

  const [storedSamplesCount, lastCollectedAt, stored] = await Promise.all([
    WebmasterBacklinksRepository.countSamples(
      input.projectId,
      "bing_webmaster",
    ),
    WebmasterBacklinksRepository.lastCollectedAt(
      input.projectId,
      "bing_webmaster",
    ),
    freshSamples
      ? Promise.resolve(null)
      : WebmasterBacklinksRepository.listSamples(
          input.projectId,
          "bing_webmaster",
          SAMPLES_PAGE_LIMIT,
        ),
  ]);

  return {
    connected: true,
    siteUrl: connection.siteUrl,
    unavailableReason: null,
    ...counts,
    samples:
      freshSamples ??
      (stored ?? []).map((sample) => ({
        sourceUrl: sample.sourceUrl,
        destinationUrl: sample.destinationUrl,
        // The shared sample table keeps the pair only — Bing's anchor text is
        // not persisted, so stored rows render without it.
        anchorText: null,
      })),
    storedSamplesCount,
    lastCollectedAt,
    collectError,
  };
}

export const BingWebmasterService = {
  getConnection,
  listSites,
  listSitesForApiKey,
  setSite,
  disconnect,
  getSearchPerformance,
  getLinks,
};
