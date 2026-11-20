import { sort } from "remeda";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import type { GscConnection } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { GscTokenError } from "@/server/lib/gscErrors";
import {
  createGscClient,
  type UrlInspectionResult,
} from "@/server/lib/gscClient";
import { createYandexWebmasterClient } from "@/server/lib/yandexWebmasterClient";
import type { YandexSearchEventSample } from "@/server/lib/yandexWebmasterClient";
import type { IndexStatusCheckRow } from "../repositories/IndexStatusRepository";
import { IndexStatusRepository } from "../repositories/IndexStatusRepository";

// Google's URL Inspection API is quota-metered (2,000 calls/day per property —
// Google's documented limit), so inspections are capped per refresh and cached:
// a stored verdict is reused for INSPECTION_TTL_MS and re-renders never re-call
// the API. Everything cheaper (search analytics, Yandex samples) re-collects
// on the normal TTL.
const INSPECTIONS_PER_COLLECT = 50;
const INSPECTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Impressions in this window ≈ the page is in Google's index.
const GSC_IMPRESSIONS_WINDOW_DAYS = 90;
const GSC_PAGES_ROW_LIMIT = 1000;
const YANDEX_SAMPLES_PAGE_SIZE = 100;
const YANDEX_SAMPLES_MAX_PAGES = 10;
const AUDIT_PAGES_LIMIT = 2000;

/** Per-engine collect outcome surfaced by the page (see ensureCollected). */
export type EngineState = {
  unavailableReason: string | null;
  collectError: string | null;
};

// Human wording for Yandex's excluded-url statuses (Webmaster API v4
// ApiExcludedUrlStatus). Raw codes are kept when unmapped.
const YANDEX_EXCLUDED_REASONS: Record<string, string> = {
  NOTHING_FOUND: "Page unknown or long unavailable",
  HOST_ERROR: "Robot could not connect to the server",
  REDIRECT_NOTSEARCHABLE: "Page redirects to another page",
  HTTP_ERROR: "HTTP error when accessing the page",
  NOT_CANONICAL: "Indexed via the rel=canonical URL",
  NOT_MAIN_MIRROR: "Page belongs to a secondary mirror of the site",
  PARSER_ERROR: "Robot could not retrieve the page content",
  ROBOTS_HOST_ERROR: "Site is blocked in robots.txt",
  ROBOTS_URL_ERROR: "Page is blocked in robots.txt",
  DUPLICATE: "Duplicates a page already in search",
  LOW_QUALITY: "Removed by a quality algorithm",
  CLEAN_PARAMS: "Excluded after Clean-params processing",
  NO_INDEX: "Page has a noindex meta tag",
  OTHER: "No updated robot data",
};

function describeYandexExclusion(event: YandexSearchEventSample): string {
  const code = event.excludedUrlStatus ?? "OTHER";
  const base = YANDEX_EXCLUDED_REASONS[code] ?? code;
  if (code === "REDIRECT_NOTSEARCHABLE" && event.targetUrl)
    return `${base} → ${event.targetUrl}`;
  if (code === "HTTP_ERROR" && event.badHttpStatus != null)
    return `${base} (${event.badHttpStatus})`;
  return base;
}

/** Normalize a page URL for cross-engine matching: lowercase host, drop
 *  default port, strip fragment and non-root trailing slash. Returns null for
 *  non-URL garbage and non-http(s) schemes, which collect skips. */
function normalizePageUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    )
      url.port = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/"))
      url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedSet(urls: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of urls) {
    const url = normalizePageUrl(raw);
    if (url !== null) out.add(url);
  }
  return out;
}

/** URL Inspection result → check row. PASS verdicts mean indexed; anything
 *  else (NEUTRAL duplicates, NEGATIVE errors) means not indexed, with Google's
 *  coverageState naming why. */
function inspectionToCheck(
  result: UrlInspectionResult | null,
): { status: "indexed" | "not_indexed"; reason: string | null } | null {
  const index = result?.indexStatusResult;
  if (!index?.verdict) return null;
  return {
    status: index.verdict === "PASS" ? "indexed" : "not_indexed",
    reason: index.coverageState ?? null,
  };
}

/** Whether a stored Google check is a URL-inspection verdict still inside its
 *  reuse window — such pages are neither re-inspected nor downgraded to the
 *  impressions heuristic. */
function freshInspection(check: IndexStatusCheckRow | undefined): boolean {
  return (
    check?.evidence === "url_inspection" &&
    Date.now() - Date.parse(check.checkedAt) < INSPECTION_TTL_MS
  );
}

/** Pages from the latest site audit (read-only): crawled URLs join the page
 *  universe even when no search engine has reported them yet. Returns false
 *  when there is nothing to record (no audit yet), so the caller knows not to
 *  mark the collector as done for this cycle. */
export async function collectAuditPages(input: {
  projectId: string;
  now: string;
}): Promise<boolean> {
  const audit = await AuditRepository.getLatestAuditForProject(input.projectId);
  if (!audit) return false;
  const pages = await AuditRepository.getPagesForAudit(audit.id);
  const urls = [
    ...normalizedSet(pages.slice(0, AUDIT_PAGES_LIMIT).map((page) => page.url)),
  ];
  if (urls.length === 0) return false;
  await IndexStatusRepository.upsertPages(
    input.projectId,
    urls.map((url) => ({ url, seenAt: input.now })),
  );
  const pageIds = await IndexStatusRepository.listPageIds(input.projectId);
  await IndexStatusRepository.saveSources(
    urls.flatMap((url) => {
      const pageId = pageIds.get(url);
      return pageId ? [{ pageId, source: "audit_crawl" as const }] : [];
    }),
  );
  return true;
}

/** GSC collect: pages with impressions (≈ in index) plus a quota-capped batch
 *  of URL inspections with per-page reasons. */
export async function collectGoogle(input: {
  projectId: string;
  connection: GscConnection;
  now: string;
}): Promise<EngineState> {
  const client = createGscClient({
    userId: input.connection.connectedByUserId,
    gscAccountId: input.connection.gscAccountId ?? undefined,
  });
  const state: EngineState = { unavailableReason: null, collectError: null };

  const rows = await client.querySearchAnalytics(input.connection.siteUrl, {
    startDate: new Date(
      Date.now() - GSC_IMPRESSIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    dimensions: ["page"],
    rowLimit: GSC_PAGES_ROW_LIMIT,
    dataState: "all",
  });
  const impressionUrls = normalizedSet(
    rows.map((row) => row.keys?.[0]).filter((url): url is string => !!url),
  );

  await IndexStatusRepository.upsertPages(
    input.projectId,
    [...impressionUrls].map((url) => ({ url, seenAt: input.now })),
  );
  const pageIds = await IndexStatusRepository.listPageIds(input.projectId);
  await IndexStatusRepository.saveSources(
    [...impressionUrls].flatMap((url) => {
      const pageId = pageIds.get(url);
      return pageId ? [{ pageId, source: "gsc_search" as const }] : [];
    }),
  );

  const existing = await IndexStatusRepository.listChecks(input.projectId);
  const googleChecks = new Map(
    existing
      .filter((check) => check.engine === "google")
      .map((check) => [check.url, check]),
  );

  // Impressions are a weaker signal than an inspection: only write them for
  // pages without a fresh stored inspection.
  const impressionWrites = [...impressionUrls].flatMap((url) => {
    if (freshInspection(googleChecks.get(url))) return [];
    const pageId = pageIds.get(url);
    return pageId
      ? [
          {
            pageId,
            engine: "google" as const,
            status: "likely_indexed" as const,
            reason: null,
            evidence: "gsc_impressions" as const,
            checkedAt: input.now,
          },
        ]
      : [];
  });
  // The impressions heuristic's complement: a page the universe knows (Yandex
  // index, audit crawl, or GSC itself) with zero Google impressions over the
  // window is presumably not in Google's index — a named-presumption check,
  // not "no data", so the problems filter can surface it. A URL inspection
  // (the stronger signal) overwrites it; same freshness guard as impressions.
  const noImpressionWrites = [...pageIds].flatMap(([url, pageId]) => {
    if (impressionUrls.has(url)) return [];
    if (freshInspection(googleChecks.get(url))) return [];
    return [
      {
        pageId,
        engine: "google" as const,
        status: "not_indexed" as const,
        reason: "No Google impressions in 90 days — presumably not indexed",
        evidence: "gsc_no_impressions" as const,
        checkedAt: input.now,
      },
    ];
  });
  await IndexStatusRepository.saveChecks([
    ...impressionWrites,
    ...noImpressionWrites,
  ]);

  const candidates = inspectionCandidates(
    [...pageIds.keys()],
    googleChecks,
  ).slice(0, INSPECTIONS_PER_COLLECT);
  for (const url of candidates) {
    try {
      const result = await client.inspectUrl(input.connection.siteUrl, url);
      const check = inspectionToCheck(result);
      const pageId = pageIds.get(url);
      if (!check || pageId === undefined) continue;
      await IndexStatusRepository.saveChecks([
        {
          pageId,
          engine: "google",
          status: check.status,
          reason: check.reason,
          evidence: "url_inspection",
          checkedAt: input.now,
        },
      ]);
    } catch (error) {
      if (error instanceof GscTokenError) throw error;
      // Quota (429) or a per-URL failure: keep what we collected so far and
      // surface why inspections stopped — never fail the whole collect.
      state.collectError =
        error instanceof Error ? error.message : String(error);
      break;
    }
  }
  return state;
}

/** Inspection priority rank: unknown pages (0) first, then impression-only
 *  pages (1), then stale verdicts (2). */
function inspectionRank(check: IndexStatusCheckRow | undefined): number {
  if (check === undefined) return 0;
  return check.evidence === "url_inspection" ? 2 : 1;
}

/** Inspection candidates ordered so the quota goes where the answer is least
 *  known; stale verdicts oldest-first within their rank. */
function inspectionCandidates(
  urls: string[],
  googleChecks: Map<string, IndexStatusCheckRow>,
): string[] {
  const checkedAtMs = (url: string): number => {
    const check = googleChecks.get(url);
    return check ? Date.parse(check.checkedAt) : 0;
  };
  return sort(
    urls.filter((url) => !freshInspection(googleChecks.get(url))),
    (a, b) => {
      const rankDiff =
        inspectionRank(googleChecks.get(a)) -
        inspectionRank(googleChecks.get(b));
      return rankDiff !== 0 ? rankDiff : checkedAtMs(a) - checkedAtMs(b);
    },
  );
}

/** Yandex collect: current in-search samples plus removal events with
 *  per-page exclusion reasons. In-search beats events (current beats
 *  historical); the latest event per URL wins within the event feed. */
export async function collectYandex(input: {
  projectId: string;
  hostId: string;
  connectedByUserId: string;
  yandexAccountId: string | null;
  now: string;
}): Promise<void> {
  const client = createYandexWebmasterClient({
    userId: input.connectedByUserId,
    yandexAccountId: input.yandexAccountId ?? undefined,
  });

  const inSearch = new Set<string>();
  const eventsByUrl = new Map<string, YandexSearchEventSample>();
  let offset = 0;
  for (let page = 0; page < YANDEX_SAMPLES_MAX_PAGES; page += 1) {
    const result = await client.getInSearchSamples(input.hostId, {
      limit: YANDEX_SAMPLES_PAGE_SIZE,
      offset,
    });
    if (result.samples.length === 0) break;
    for (const sample of result.samples) {
      const url = normalizePageUrl(sample.url);
      if (url !== null) inSearch.add(url);
    }
    offset += result.samples.length;
    if (result.samples.length < YANDEX_SAMPLES_PAGE_SIZE) break;
  }
  offset = 0;
  for (let page = 0; page < YANDEX_SAMPLES_MAX_PAGES; page += 1) {
    const result = await client.getSearchEventSamples(input.hostId, {
      limit: YANDEX_SAMPLES_PAGE_SIZE,
      offset,
    });
    if (result.samples.length === 0) break;
    for (const sample of result.samples) {
      const url = normalizePageUrl(sample.url);
      if (url === null) continue;
      // A URL can appear in several events; the latest one wins.
      const prev = eventsByUrl.get(url);
      if (
        prev === undefined ||
        (sample.eventDate ?? "") >= (prev.eventDate ?? "")
      )
        eventsByUrl.set(url, sample);
    }
    offset += result.samples.length;
    if (result.samples.length < YANDEX_SAMPLES_PAGE_SIZE) break;
  }

  const universe = new Set([...inSearch, ...eventsByUrl.keys()]);
  await IndexStatusRepository.upsertPages(
    input.projectId,
    [...universe].map((url) => ({ url, seenAt: input.now })),
  );
  const pageIds = await IndexStatusRepository.listPageIds(input.projectId);
  await IndexStatusRepository.saveSources(
    [...universe].flatMap((url) => {
      const pageId = pageIds.get(url);
      return pageId ? [{ pageId, source: "yandex_samples" as const }] : [];
    }),
  );

  const checks = new Map<
    string,
    Parameters<typeof IndexStatusRepository.saveChecks>[0][number]
  >();
  for (const [url, event] of eventsByUrl) {
    const pageId = pageIds.get(url);
    if (pageId === undefined) continue;
    checks.set(url, {
      pageId,
      engine: "yandex",
      status: event.event === "REMOVED_FROM_SEARCH" ? "not_indexed" : "indexed",
      reason:
        event.event === "REMOVED_FROM_SEARCH"
          ? describeYandexExclusion(event)
          : null,
      evidence: "yandex_event",
      checkedAt: input.now,
    });
  }
  for (const url of inSearch) {
    const pageId = pageIds.get(url);
    if (pageId === undefined) continue;
    checks.set(url, {
      pageId,
      engine: "yandex",
      status: "indexed",
      reason: null,
      evidence: "yandex_in_search",
      checkedAt: input.now,
    });
  }
  await IndexStatusRepository.saveChecks([...checks.values()]);
}
