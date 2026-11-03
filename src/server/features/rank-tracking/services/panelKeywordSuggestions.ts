import { normalizeDomain } from "@/types/schemas/domain";
import { GscService } from "@/server/features/gsc/services/GscService";
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
 *  fails the request, it just contributes nothing. */
async function get(input: {
  projectId: string;
  domain?: string;
}): Promise<PanelKeywordSuggestionsResult> {
  const [gscConnection, yandexConnection] = await Promise.all([
    GscService.getConnection(input.projectId),
    YandexWebmasterService.getConnection(input.projectId),
  ]);

  const fetches: Array<{
    source: PanelKeywordSource;
    run: () => Promise<PanelKeywordSuggestion[]>;
  }> = [];
  if (gscConnection && siteCoversDomain(gscConnection.siteUrl, input.domain)) {
    fetches.push({
      source: "gsc",
      run: () => fetchGscQueries(input.projectId),
    });
  }
  if (
    yandexConnection &&
    siteCoversDomain(yandexConnection.hostUrl, input.domain)
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
    (
      await RankTrackingRepository.getKeywordsForActiveConfigs(input.projectId)
    ).map((kw) => kw.keyword.trim().toLowerCase()),
  );

  // Highest impressions first. A query reported by both panels keeps the panel
  // that saw more impressions for it, so the metrics stay single-engine honest.
  rows.sort((a, b) => b.impressions - a.impressions);
  const seen = new Set<string>();
  const suggestions: PanelKeywordSuggestion[] = [];
  for (const row of rows) {
    const key = row.query.trim().toLowerCase();
    if (!key || tracked.has(key) || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ ...row, query: row.query.trim() });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  return { suggestions, sources: fetches.map((fetch) => fetch.source) };
}

export const PanelKeywordSuggestions = { get };
