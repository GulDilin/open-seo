import {
  type AdsKeywordIdeaItem,
  type LabsKeywordDataItem,
} from "@/server/lib/dataforseo";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CreditFeature } from "@/shared/billing-credit-features";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import {
  normalizeIntent,
  normalizeKeyword,
  type EnrichedKeyword,
} from "./helpers";
import { wordstatTopRequests } from "@/server/lib/seo-providers/yandex/client";
import { generateKeywordIdeas } from "@/server/lib/seo-providers/google-ads/client";
import {
  getIsoCountryCode,
  getLocationCodeForIsoCountry,
} from "@/shared/keyword-locations";
import { AppError } from "@/server/lib/errors";
import type { KeywordSource } from "./selection";

type FetchResearchRowsParams = {
  seedKeyword: string;
  locationCode: number;
  languageCode: string;
  resultLimit: number;
  source: KeywordSource;
  includeClickstreamData?: boolean;
  ignoreSynonyms?: boolean;
  // Attribute the DataForSEO spend to a specific feature (e.g. "agent");
  // defaults to the path-derived feature when omitted.
  creditFeature?: CreditFeature;
};

function mapKeywordDataItems(items: LabsKeywordDataItem[]): EnrichedKeyword[] {
  const rows: EnrichedKeyword[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const keyword = item.keyword;
    if (!keyword) continue;

    const normalized = normalizeKeyword(keyword);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // The clickstream-normalized block only exists when the caller opted into
    // clickstream data (it doubles the request cost); prefer it when present.
    const keywordInfo = item.keyword_info_normalized_with_clickstream
      ?.search_volume
      ? item.keyword_info_normalized_with_clickstream
      : item.keyword_info;

    rows.push({
      keyword: normalized,
      searchVolume: keywordInfo?.search_volume ?? null,
      trend: (keywordInfo?.monthly_searches ?? []).map((entry) => ({
        year: entry.year ?? 0,
        month: entry.month ?? 0,
        searchVolume: entry.search_volume ?? 0,
      })),
      cpc: item.keyword_info?.cpc ?? null,
      competition: item.keyword_info?.competition ?? null,
      keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
      intent: normalizeIntent(item.search_intent_info?.main_intent),
    });
  }

  return rows;
}

/**
 * Google Ads items carry volume / CPC / paid competition but no keyword
 * difficulty or search intent (those are Labs-only).
 */
export function mapAdsKeywordItems(
  items: AdsKeywordIdeaItem[],
): EnrichedKeyword[] {
  const rows: EnrichedKeyword[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const keyword = item.keyword;
    if (!keyword) continue;

    const normalized = normalizeKeyword(keyword);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    rows.push({
      keyword: normalized,
      searchVolume: item.search_volume ?? null,
      trend: (item.monthly_searches ?? []).map((entry) => ({
        year: entry.year ?? 0,
        month: entry.month ?? 0,
        searchVolume: entry.search_volume ?? 0,
      })),
      cpc: item.cpc ?? null,
      competition:
        item.competition_index != null ? item.competition_index / 100 : null,
      keywordDifficulty: null,
      intent: "unknown",
    });
  }

  return rows;
}

/** Research rows for countries DataForSEO Labs doesn't support. */
export async function fetchGoogleAdsResearchRows(
  params: Omit<FetchResearchRowsParams, "source">,
  billingCustomer: BillingCustomerContext,
): Promise<EnrichedKeyword[]> {
  const dataforseo = createDataforseoClient(billingCustomer);
  return mapAdsKeywordItems(
    await dataforseo.keywords.adsIdeas({
      keyword: params.seedKeyword,
      locationCode: params.locationCode,
      languageCode: params.languageCode,
      limit: params.resultLimit,
      creditFeature: params.creditFeature,
    }),
  );
}

/**
 * Research rows from the operator's own Google Ads API (BYO, decisions §8):
 * the idea list IS generateKeywordIdeas output for the seed — the same
 * Keyword Planner suggestions the incumbent resold. Volumes are Google's
 * bucketed avg-monthly numbers, CPC comes from averageCpcMicros (opt-in);
 * difficulty/intent do not exist here (nulls, same pattern as Ads rows).
 */
export async function fetchGoogleAdsIdeaRows(
  params: Omit<FetchResearchRowsParams, "source">,
): Promise<EnrichedKeyword[]> {
  const locationCode = getLocationCodeForIsoCountry(
    getIsoCountryCode(params.locationCode),
  );
  if (locationCode == null) {
    throw new AppError(
      "VALIDATION_ERROR",
      `No market registered for location ${params.locationCode}`,
    );
  }
  const ideas = await generateKeywordIdeas({
    keywords: [params.seedKeyword],
    locationCode,
    languageCode: params.languageCode,
    ideaCount: params.resultLimit,
  });
  const rows: EnrichedKeyword[] = [];
  const seen = new Set<string>();
  for (const idea of ideas) {
    const normalized = normalizeKeyword(idea.keyword);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push({
      keyword: normalized,
      searchVolume: idea.volume,
      trend: idea.monthly.map((m) => ({
        year: m.year,
        month: m.month,
        searchVolume: m.searchVolume,
      })),
      cpc: idea.cpc,
      competition: null,
      keywordDifficulty: null,
      intent: "unknown",
    });
  }
  return rows;
}

/**
 * Research rows for the Russia market: the keyword list IS Wordstat's top
 * requests containing the seed (the same list the public Wordstat UI shows),
 * volumes are each phrase's own count. Wordstat has no difficulty, intent,
 * CPC, or competition — nulls, never invented (same pattern as Ads rows).
 */
export async function fetchWordstatResearchRows(
  params: Omit<FetchResearchRowsParams, "source"> & { region?: string },
): Promise<EnrichedKeyword[]> {
  const top = await wordstatTopRequests({
    phrase: params.seedKeyword,
    numPhrases: params.resultLimit,
    ...(params.region ? { regions: [params.region] } : {}),
  });
  const rows: EnrichedKeyword[] = [];
  const seen = new Set<string>();
  for (const item of top.results) {
    const normalized = normalizeKeyword(item.phrase);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push({
      keyword: normalized,
      searchVolume: Number(item.count),
      trend: [],
      cpc: null,
      competition: null,
      keywordDifficulty: null,
      intent: "unknown",
    });
  }
  return rows;
}

async function fetchRelatedRows(
  params: Omit<FetchResearchRowsParams, "source">,
  dataforseo: ReturnType<typeof createDataforseoClient>,
) {
  const items = await dataforseo.keywords.related({
    keyword: params.seedKeyword,
    locationCode: params.locationCode,
    languageCode: params.languageCode,
    limit: params.resultLimit,
    depth: 3,
    includeClickstreamData: params.includeClickstreamData,
    ignoreSynonyms: params.ignoreSynonyms,
    creditFeature: params.creditFeature,
  });

  // Related items wrap the keyword payload one level deeper; unwrap and reuse
  // the same mapper as suggestions/ideas.
  return mapKeywordDataItems(
    items
      .map((item) => item.keyword_data)
      .filter((data): data is NonNullable<typeof data> => data != null),
  );
}

export async function fetchResearchRowsBySource(
  params: FetchResearchRowsParams,
  billingCustomer: BillingCustomerContext,
): Promise<EnrichedKeyword[]> {
  const dataforseo = createDataforseoClient(billingCustomer);

  if (params.source === "related") {
    return fetchRelatedRows(params, dataforseo);
  }

  if (params.source === "suggestions") {
    return mapKeywordDataItems(
      await dataforseo.keywords.suggestions({
        keyword: params.seedKeyword,
        locationCode: params.locationCode,
        languageCode: params.languageCode,
        limit: params.resultLimit,
        includeClickstreamData: params.includeClickstreamData,
        ignoreSynonyms: params.ignoreSynonyms,
        creditFeature: params.creditFeature,
      }),
    );
  }

  return mapKeywordDataItems(
    await dataforseo.keywords.ideas({
      keyword: params.seedKeyword,
      locationCode: params.locationCode,
      languageCode: params.languageCode,
      limit: params.resultLimit,
      includeClickstreamData: params.includeClickstreamData,
      ignoreSynonyms: params.ignoreSynonyms,
      creditFeature: params.creditFeature,
    }),
  );
}
