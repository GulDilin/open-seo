import { normalizeDomain } from "@/types/schemas/domain";
import type { RankTrackingConfig } from "@/types/schemas/rank-tracking";
import { hasSearchOperator } from "@/shared/rank-tracking";
import { GscService } from "@/server/features/gsc/services/GscService";
import { GSC_MAX_ROW_LIMIT } from "@/server/features/gsc/searchAnalytics";
import { YandexWebmasterService } from "@/server/features/yandex/services/YandexWebmasterService";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";

type PanelKeywordSource = "gsc" | "yandex_webmaster";

type PanelKeywordSuggestion = {
  query: string;
  source: PanelKeywordSource;
  impressions: number;
  clicks: number;
  position: number | null;
};

type PanelKeywordSuggestionsResult = {
  suggestions: PanelKeywordSuggestion[];
  /** Panels with a connection for this project. Empty means the UI should
   *  show its "connect a panel" hint instead of an error. */
  sources: PanelKeywordSource[];
};

const MAX_SUGGESTIONS = 50;

async function fetchGscQueries(
  projectId: string,
): Promise<PanelKeywordSuggestion[]> {
  const result = await GscService.getPerformance({
    projectId,
    dimensions: ["query"],
    dateRange: "last_28_days",
    dataState: "final",
    // The pool ranks by impressions, but GSC returns rows ordered by clicks —
    // a click-sorted page hides high-impression queries. Pull the max so the
    // impressions ranking sees the full picture and subtracting already-tracked
    // keywords still leaves enough candidates to fill the import cap (300).
    rowLimit: GSC_MAX_ROW_LIMIT,
  });
  return result.rows.flatMap((row) => {
    const query = row.keys?.[0];
    return query
      ? [
          {
            query,
            source: "gsc",
            impressions: row.impressions,
            clicks: row.clicks,
            position: row.position,
          },
        ]
      : [];
  });
}

async function fetchYandexQueries(
  projectId: string,
): Promise<PanelKeywordSuggestion[]> {
  const result = await YandexWebmasterService.getSearchPerformance({
    projectId,
    dateRange: "last_28_days",
    orderBy: "impressions",
    // Only the query rows matter here; the previous-window comparison doubles
    // the popular-queries pages per sync for cards the pool never shows.
    includeChange: false,
  });
  return result.rows.map((row) => ({
    query: row.query,
    source: "yandex_webmaster",
    impressions: row.impressions ?? 0,
    clicks: row.clicks ?? 0,
    // GSC reports average position over impressions, so use Yandex's matching
    // avgShowPosition rather than the click-position average.
    position: row.avgShowPosition,
  }));
}

/** A panel covers the tracked domain when the hosts match or one is a subdomain
 *  of the other (GSC stores "sc-domain:example.com" or a URL prefix; Yandex
 *  stores the host URL). An unparseable site value never hides a source. */
function siteCoversDomain(
  siteUrl: string | null | undefined,
  domain: string | undefined,
): boolean {
  if (!siteUrl || !domain) return true;
  try {
    const host = normalizeDomain(siteUrl.replace(/^sc-domain:/i, ""));
    return (
      host === domain ||
      host.endsWith(`.${domain}`) ||
      domain.endsWith(`.${host}`)
    );
  } catch {
    return true;
  }
}

/** Keyword suggestions from the site panels connected to a project. Each
 *  connected panel is fetched independently — one dead or missing panel never
 *  fails the request, it just contributes nothing. `limit` raises the cap for
 *  the auto-import sync; the manual pick UI keeps the 50 default. `source`
 *  restricts to one panel's queries (the auto-import sync caps per source, so
 *  a busy panel can't consume the other's allocation). `subtract: "domain"`
 *  hides only keywords tracked for THIS domain instead of the whole project —
 *  auto-import for one domain must not be blocked by another domain's tracker.
 *  `engines` scopes subtraction to trackers on those engines: a query a
 *  google tracker already checks is still worth suggesting to a yandex one. */
async function get(input: {
  projectId: string;
  domain?: string;
  limit?: number;
  source?: PanelKeywordSource;
  subtract?: "project" | "domain";
  engines?: RankTrackingConfig["searchEngine"][];
}): Promise<PanelKeywordSuggestionsResult> {
  const [gscConnection, yandexConnection] = await Promise.all([
    GscService.getConnection(input.projectId),
    YandexWebmasterService.getConnection(input.projectId),
  ]);

  const fetches: Array<{
    source: PanelKeywordSource;
    run: () => Promise<PanelKeywordSuggestion[]>;
  }> = [];
  if (
    gscConnection &&
    siteCoversDomain(gscConnection.siteUrl, input.domain) &&
    (!input.source || input.source === "gsc")
  ) {
    fetches.push({
      source: "gsc",
      run: () => fetchGscQueries(input.projectId),
    });
  }
  if (
    yandexConnection &&
    siteCoversDomain(yandexConnection.hostUrl, input.domain) &&
    (!input.source || input.source === "yandex_webmaster")
  ) {
    fetches.push({
      source: "yandex_webmaster",
      run: () => fetchYandexQueries(input.projectId),
    });
  }

  const settled = await Promise.allSettled(fetches.map((fetch) => fetch.run()));
  const rows: PanelKeywordSuggestion[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      rows.push(...result.value);
    } else {
      console.error(
        `[panel-keywords] ${fetches[i].source} query fetch failed:`,
        result.reason,
      );
    }
  });

  const tracked = new Set(
    (input.subtract === "domain" && input.domain
      ? // Domain-scoped subtraction: a query another domain already tracks
        // must not block THIS domain's auto-import.
        await RankTrackingRepository.getKeywordsForActiveConfigs(
          input.projectId,
          input.domain,
          input.engines,
        )
      : await RankTrackingRepository.getKeywordsForActiveConfigs(
          input.projectId,
          undefined,
          input.engines,
        )
    ).map((kw) => kw.keyword.trim().toLowerCase()),
  );

  // Highest impressions first. A query reported by both panels keeps the panel
  // that saw more impressions for it, so the metrics stay single-engine honest.
  const maxSuggestions = input.limit ?? MAX_SUGGESTIONS;
  rows.sort((a, b) => b.impressions - a.impressions);
  const seen = new Set<string>();
  const suggestions: PanelKeywordSuggestion[] = [];
  for (const row of rows) {
    const key = row.query.trim().toLowerCase();
    if (
      !key ||
      tracked.has(key) ||
      seen.has(key) ||
      // Panels report operator lookups (site:example.com) as queries; they
      // are not search phrases.
      hasSearchOperator(row.query)
    )
      continue;
    seen.add(key);
    suggestions.push({ ...row, query: row.query.trim() });
    if (suggestions.length >= maxSuggestions) break;
  }

  return { suggestions, sources: fetches.map((fetch) => fetch.source) };
}

export const PanelKeywordSuggestions = { get };
