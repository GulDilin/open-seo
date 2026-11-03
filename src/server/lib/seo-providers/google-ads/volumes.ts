import type {
  KeywordDataProvider,
  KeywordVolumeQuery,
  KeywordVolumeRow,
} from "@/server/lib/seo-providers/types";
import { getLocationCodeForIsoCountry } from "@/shared/keyword-locations";
import { AppError } from "@/server/lib/errors";
import { generateKeywordIdeas } from "./client";

/**
 * Google Ads keyword volumes (BYO, decisions §8): avg monthly searches per
 * keyword, bucketed without ad spend, plus CPC (averageCpcMicros, opt-in)
 * and the 12-month history. Competition stays null on the numeric scale —
 * the source's categorical enum is not invented into 0..1 — and so does
 * difficulty. Wordstat stays the source for Russia.
 */
export const googleAdsVolumesProvider: KeywordDataProvider = {
  id: "googleads",
  async getVolumes(queries: KeywordVolumeQuery[]): Promise<KeywordVolumeRow[]> {
    // One idea request per country; our numeric market codes ARE Google geo
    // target criterion ids, and the ISO country maps back through the
    // registry. Queries in one call share a market in practice (research
    // and refresh are per-market), so a single grouped call is enough.
    const byCountry = new Map<string, KeywordVolumeQuery[]>();
    for (const query of queries) {
      const list = byCountry.get(query.country) ?? [];
      list.push(query);
      byCountry.set(query.country, list);
    }
    const rows: KeywordVolumeRow[] = [];
    for (const [country, group] of byCountry) {
      // Our numeric market codes ARE Google geo criterion ids; resolve the
      // ISO country back to one so targeting matches the market registry.
      const locationCode = getLocationCodeForIsoCountry(country);
      if (locationCode == null) {
        throw new AppError(
          "VALIDATION_ERROR",
          `No market registered for country "${country}"`,
        );
      }
      const ideas = await generateKeywordIdeas({
        keywords: group.map((query) => query.keyword),
        locationCode,
        languageCode: group[0].language,
      });
      const byKeyword = new Map(
        ideas.map((idea) => [idea.keyword.toLowerCase(), idea]),
      );
      for (const query of group) {
        const idea = byKeyword.get(query.keyword.toLowerCase());
        rows.push({
          keyword: query.keyword,
          volume: idea?.volume ?? null,
          cpc: idea?.cpc ?? null,
          competition: null,
          difficulty: null,
          monthly: idea?.monthly ?? [],
          source: "google_ads",
        });
      }
    }
    return rows;
  },
};
