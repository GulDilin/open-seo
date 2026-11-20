import { AUTO_IMPORT_KEYWORDS_PER_CONFIG } from "@/shared/rank-tracking";
import type { RankTrackingConfig } from "@/types/schemas/rank-tracking";
import { RankTrackingKeywordService } from "./RankTrackingKeywordService";
import { PanelKeywordSuggestions } from "./panelKeywordSuggestions";

/**
 * Opt-in keyword sync: pulls fresh queries from the project's connected
 * panels into trackers flagged `autoKeywordImport`, so trackers populate
 * without manual entry. Called right after a tracker is created with the
 * toggle on, and before each scheduled check so new queries join the same
 * run.
 *
 * Source → engine mapping: a query the panels reported for an engine only
 * feeds trackers on that engine (GSC → google/bing/baidu, Yandex Webmaster →
 * yandex), so an imported keyword never buys SERP checks on an engine it
 * didn't come from. Suggestions are fetched per source so each engine's
 * trackers get the source's own top-N (a merged list would let a busy panel
 * consume the other's allocation).
 */
const SOURCE_ENGINES: Record<
  "gsc" | "yandex_webmaster",
  RankTrackingConfig["searchEngine"][]
> = {
  gsc: ["google", "bing", "baidu"],
  yandex_webmaster: ["yandex"],
};

type AutoImportConfig = Pick<
  RankTrackingConfig,
  "id" | "projectId" | "domain" | "searchEngine"
>;

function autoImportKey(config: AutoImportConfig) {
  return `${config.projectId} ${config.domain}`;
}

/** Sync one (projectId, domain) key's panel suggestions into every config of
 *  that key. Per-config failures are logged, not thrown — one bad config must
 *  not block its siblings. */
async function syncKey(configs: AutoImportConfig[]): Promise<number> {
  // Only the sources some config of this key can consume.
  const sources = (["gsc", "yandex_webmaster"] as const).filter((source) =>
    configs.some((config) =>
      SOURCE_ENGINES[source].includes(config.searchEngine),
    ),
  );
  const perSource = new Map<
    "gsc" | "yandex_webmaster",
    Awaited<ReturnType<typeof PanelKeywordSuggestions.get>>["suggestions"]
  >();
  for (const source of sources) {
    try {
      const { suggestions } = await PanelKeywordSuggestions.get({
        projectId: configs[0].projectId,
        domain: configs[0].domain,
        limit: AUTO_IMPORT_KEYWORDS_PER_CONFIG,
        source,
        // Another domain's tracked keyword must not block this domain.
        subtract: "domain",
      });
      perSource.set(source, suggestions);
    } catch (error) {
      console.error(`[auto-import] ${source} suggestions fetch failed:`, error);
    }
  }

  const settled = await Promise.allSettled(
    configs.map(async (config) => {
      const queries = sources
        .filter((source) =>
          SOURCE_ENGINES[source].includes(config.searchEngine),
        )
        .flatMap((source) => perSource.get(source) ?? [])
        .map((suggestion) => suggestion.query)
        .slice(0, AUTO_IMPORT_KEYWORDS_PER_CONFIG);
      if (queries.length === 0) return 0;
      const result = await RankTrackingKeywordService.addKeywords(
        config.id,
        config.projectId,
        queries,
        // The user opted in when enabling the toggle; the 300-keyword cap is
        // the growth bound. (The credit_ceiling approval mode exists for
        // one-shot API consumers that must pre-approve an amount.)
        { kind: "direct_user_action" },
        false,
      );
      return result.added;
    }),
  );
  let added = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      added += outcome.value;
    } else {
      console.error(
        `[auto-import] config keyword add failed (${outcome.reason instanceof Error ? outcome.reason.message : "unknown"}):`,
        outcome.reason,
      );
    }
  }
  return added;
}

/** Sync panel keywords into the given configs, capped at `maxKeys` distinct
 *  (projectId, domain) keys — overflow keys sync on a later call. Returns
 *  keywords added; a failed panel fetch is logged and contributes zero. */
export async function syncAutoImportedKeywords(
  configs: AutoImportConfig[],
  maxKeys = Number.POSITIVE_INFINITY,
): Promise<number> {
  // One panel fetch set per (projectId, domain) — sibling configs of the same
  // market share the suggestions, filtered per engine inside.
  const byKey = new Map<string, AutoImportConfig[]>();
  for (const config of configs) {
    const key = autoImportKey(config);
    const group = byKey.get(key) ?? [];
    group.push(config);
    byKey.set(key, group);
  }

  const settled = await Promise.allSettled(
    [...byKey.values()].slice(0, maxKeys).map((group) => syncKey(group)),
  );
  let added = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      added += outcome.value;
    } else {
      console.error(
        "[auto-import] panel suggestions fetch failed:",
        outcome.reason,
      );
    }
  }
  return added;
}
