import { AppError } from "@/server/lib/errors";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CreditFeature } from "@/shared/billing-credit-features";
import {
  CACHE_TTL,
  buildCacheKey,
  getCached,
  setCached,
} from "@/server/lib/r2-cache";
import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import type { KeywordResearchRow } from "@/types/keywords";
import type { ResolvedResearchKeywordsInput } from "@/types/schemas/keywords";
import { z } from "zod";
import { getKeywordDataProvider } from "@/shared/keyword-locations";
import {
  interleaveRows,
  normalizeKeyword,
  type EnrichedKeyword,
} from "./helpers";
import {
  assertLocalResearchLocation,
  localizeResearchRows,
} from "./local-volume";
import {
  fetchGoogleAdsIdeaRows,
  fetchGoogleAdsResearchRows,
  fetchResearchRowsBySource,
  fetchWordstatResearchRows,
} from "./research-data";
import { getSeoProviderStatuses } from "@/server/lib/seo-providers/providers";
import {
  MIN_NON_SEED_FOR_AUTO,
  countNonSeedKeywords,
  type KeywordMode,
  type KeywordSource,
  type ResearchSource,
} from "./selection";

type ResearchResult = {
  rows: KeywordResearchRow[];
  source: ResearchSource;
  usedFallback: boolean;
};

type CachedResult = ResearchResult;

const cachedKeywordRowSchema = z.object({
  keyword: z.string(),
  searchVolume: z.number().nullable(),
  trend: z.array(
    z.object({
      year: z.number(),
      month: z.number(),
      searchVolume: z.number(),
    }),
  ),
  cpc: z.number().nullable(),
  competition: z.number().nullable(),
  keywordDifficulty: z.number().nullable(),
  intent: z.enum([
    "informational",
    "commercial",
    "transactional",
    "navigational",
    "unknown",
  ]),
});

const cachedResultSchema = z.object({
  rows: z.array(cachedKeywordRowSchema),
  source: z.enum([
    "related",
    "suggestions",
    "ideas",
    "google_ads",
    "wordstat",
    "blended",
  ]),
  usedFallback: z.boolean(),
});

// v5: auto mode blends suggestions + ideas. v4 (collapsed close variants)
// only ran in previews; skip it so those entries are never reused.
const CACHE_VERSION = 5;

async function fetchRowsFromSource(
  source: KeywordSource,
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  billingCustomer: BillingCustomerContext,
  opts: { creditFeature?: CreditFeature; resultLimit?: number } = {},
): Promise<EnrichedKeyword[]> {
  return fetchResearchRowsBySource(
    {
      source,
      seedKeyword,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      resultLimit: opts.resultLimit ?? input.resultLimit,
      includeClickstreamData: input.clickstream,
      ignoreSynonyms: !input.groupKeywords,
      creditFeature: opts.creditFeature,
    },
    billingCustomer,
  );
}

/**
 * Auto blends phrase-match suggestions with category-level ideas, half the
 * limit each. Neither works as a sole default: suggestions miss sibling head
 * terms ("respite care" for "caregiving") and ideas drift toward generic
 * category terms. The old related-first behavior is worse than both — its
 * depth-3 "people also search for" graph is tiny for broad seeds and full of
 * SERP-adjacency noise — so related is only a fallback for obscure seeds
 * where the blend comes back thin.
 */
async function fetchAutoRows(
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  billingCustomer: BillingCustomerContext,
  creditFeature?: CreditFeature,
): Promise<ResearchResult> {
  const blendOpts = {
    creditFeature,
    resultLimit: Math.ceil(input.resultLimit / 2),
  };
  // Settled, not Promise.all: each call meters its own DataForSEO spend, and
  // workerd cancels in-flight I/O once a response is sent, so throwing while
  // the sibling call is mid-flight can drop its billing write.
  const [suggestions, ideas] = await Promise.allSettled([
    fetchRowsFromSource(
      "suggestions",
      input,
      seedKeyword,
      billingCustomer,
      blendOpts,
    ),
    fetchRowsFromSource(
      "ideas",
      input,
      seedKeyword,
      billingCustomer,
      blendOpts,
    ),
  ]);
  if (suggestions.status === "rejected") {
    if (ideas.status === "rejected") {
      console.warn("keywords.research.ideas-leg failed:", ideas.reason);
    }
    throw suggestions.reason;
  }
  if (ideas.status === "rejected") throw ideas.reason;
  const blended = interleaveRows(
    suggestions.value,
    ideas.value,
    input.resultLimit,
  );

  if (countNonSeedKeywords(blended, seedKeyword) >= MIN_NON_SEED_FOR_AUTO) {
    return { rows: blended, source: "blended", usedFallback: false };
  }

  const related = await fetchRowsFromSource(
    "related",
    input,
    seedKeyword,
    billingCustomer,
    {
      creditFeature,
    },
  );

  return {
    rows: interleaveRows(blended, related, input.resultLimit),
    source: "blended",
    usedFallback: true,
  };
}

async function fetchGoogleAdsRows(
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  billingCustomer: BillingCustomerContext,
  creditFeature?: CreditFeature,
): Promise<ResearchResult> {
  const rows = await fetchGoogleAdsResearchRows(
    {
      seedKeyword,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      resultLimit: input.resultLimit,
      creditFeature,
    },
    billingCustomer,
  );

  return { rows, source: "google_ads", usedFallback: false };
}

/**
 * Russia rows: Wordstat top requests containing the seed. locationName on a
 * wordstat request carries the Yandex region id (region picker convention) —
 * regional demand is served directly by Wordstat, not by a local overlay.
 */
async function fetchWordstatRows(
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
): Promise<ResearchResult> {
  const rows = await fetchWordstatResearchRows({
    seedKeyword,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    resultLimit: input.resultLimit,
    region: input.locationName,
  });
  return { rows, source: "wordstat", usedFallback: false };
}

async function fetchManualRows(
  mode: Exclude<KeywordMode, "auto">,
  input: ResolvedResearchKeywordsInput,
  seedKeyword: string,
  billingCustomer: BillingCustomerContext,
  creditFeature?: CreditFeature,
): Promise<ResearchResult> {
  const rows = await fetchRowsFromSource(
    mode,
    input,
    seedKeyword,
    billingCustomer,
    {
      creditFeature,
    },
  );
  return { rows, source: mode, usedFallback: false };
}

async function buildResearchCacheKey(
  input: ResolvedResearchKeywordsInput,
  normalizedKeywords: string[],
  mode: KeywordMode,
  billingCustomer: BillingCustomerContext,
): Promise<string> {
  return buildCacheKey("kw:research", {
    cacheVersion: CACHE_VERSION,
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    keywords: normalizedKeywords,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    resultLimit: input.resultLimit,
    mode,
    depth: 3,
    clickstream: input.clickstream,
    groupKeywords: input.groupKeywords,
    locationName: input.locationName,
  });
}

function persistRows(
  input: ResolvedResearchKeywordsInput,
  rows: EnrichedKeyword[],
): Promise<void> {
  return Promise.all(
    rows.map((row) =>
      KeywordResearchRepository.upsertKeywordMetric({
        projectId: input.projectId,
        keyword: row.keyword,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        searchVolume: row.searchVolume,
        cpc: row.cpc,
        competition: row.competition,
        keywordDifficulty: row.keywordDifficulty,
        intent: row.intent,
        monthlySearchesJson: JSON.stringify(row.trend),
      }),
    ),
  ).then(
    () => undefined,
    (error: unknown) => {
      console.error("keywords.research.persist-metrics failed:", error);
    },
  );
}

export async function research(
  input: ResolvedResearchKeywordsInput,
  billingCustomer: BillingCustomerContext,
  creditFeature?: CreditFeature,
): Promise<ResearchResult> {
  const uniqueKeywords = [
    ...new Set(input.keywords.map(normalizeKeyword)),
  ].filter((keyword) => keyword.length > 0);

  if (uniqueKeywords.length === 0) {
    throw new AppError("VALIDATION_ERROR");
  }

  const seedKeyword = uniqueKeywords[0];
  const provider = getKeywordDataProvider(input.locationCode);
  // China has no keyword-volume source at all. Fail before any paid call with
  // an actionable message — rank tracking and SERP analysis still work there.
  if (provider === "none") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Keyword research is not available for this market yet. Rank tracking and SERP analysis still work here.",
    );
  }
  // Labs source modes, clickstream, and synonym filtering don't exist for
  // Google-Ads- or Wordstat-served countries; normalize them so equivalent
  // requests share one cache entry.
  const effectiveInput: ResolvedResearchKeywordsInput =
    provider === "google_ads" || provider === "wordstat"
      ? { ...input, mode: "auto", clickstream: false, groupKeywords: false }
      : input.locationName
        ? { ...input, clickstream: false }
        : input;
  const mode = effectiveInput.mode ?? "auto";
  const cacheKey = await buildResearchCacheKey(
    effectiveInput,
    uniqueKeywords,
    mode,
    billingCustomer,
  );

  const cachedRaw = await getCached(cacheKey);
  const cachedResult = cachedResultSchema.safeParse(cachedRaw);
  const cached: CachedResult | null = cachedResult.success
    ? cachedResult.data
    : null;

  if (cached && cached.rows.length > 0) {
    return cached;
  }

  // Western markets without the incumbent's key: the operator's own Google
  // Ads API supplies BOTH the idea list and the volumes (decisions §8) —
  // research keeps working with no DataForSEO account at all.
  const providerStatuses = await getSeoProviderStatuses();
  if (provider === "wordstat" && !providerStatuses.yandex) {
    // Same gate as the volume path: fail with the missing credentials named,
    // before any paid call.
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Russia keyword research needs Yandex Search API credentials (YANDEX_SEARCH_API_KEY + YANDEX_FOLDER_ID)",
    );
  }
  const googleAdsFallback =
    (provider === "labs" || provider === "google_ads") &&
    !providerStatuses.dataforseo &&
    providerStatuses.googleads;

  const result =
    provider === "wordstat"
      ? await fetchWordstatRows(effectiveInput, seedKeyword)
      : googleAdsFallback
        ? {
            rows: await fetchGoogleAdsIdeaRows({
              seedKeyword,
              locationCode: effectiveInput.locationCode,
              languageCode: effectiveInput.languageCode,
              resultLimit: effectiveInput.resultLimit,
            }),
            source: "google_ads" as const,
            usedFallback: true,
          }
        : effectiveInput.locationName
          ? await researchLocal(
              effectiveInput,
              effectiveInput.locationName,
              billingCustomer,
              creditFeature,
            )
          : provider === "google_ads"
            ? await fetchGoogleAdsRows(
                effectiveInput,
                seedKeyword,
                billingCustomer,
                creditFeature,
              )
            : mode === "auto"
              ? await fetchAutoRows(
                  effectiveInput,
                  seedKeyword,
                  billingCustomer,
                  creditFeature,
                )
              : await fetchManualRows(
                  mode,
                  effectiveInput,
                  seedKeyword,
                  billingCustomer,
                  creditFeature,
                );

  await setCached(cacheKey, result, CACHE_TTL.researchResult);
  // Keyword metrics are stored per country, so local rows are not persisted.
  if (!effectiveInput.locationName)
    void persistRows(effectiveInput, result.rows);

  return result;
}

/**
 * Keyword ideas, difficulty, and intent come from the national research
 * (cached and persisted as usual). One Google Ads call then replaces volume,
 * CPC, and competition with numbers for the city, county, or region.
 */
async function researchLocal(
  input: ResolvedResearchKeywordsInput,
  locationName: string,
  billingCustomer: BillingCustomerContext,
  creditFeature?: CreditFeature,
): Promise<ResearchResult> {
  await assertLocalResearchLocation(input.locationCode, locationName);
  const nationalInput = { ...input, locationName: undefined };
  const national = await research(
    nationalInput,
    billingCustomer,
    creditFeature,
  );
  // A save from local results sends no metrics, so the saved keyword relies on
  // the stored national ones. Store them before returning, also when the
  // national result came from the cache.
  await persistRows(nationalInput, national.rows);
  return {
    ...national,
    rows: await localizeResearchRows(
      national.rows,
      {
        locationCode: input.locationCode,
        locationName,
        languageCode: input.languageCode,
        creditFeature,
      },
      billingCustomer,
    ),
  };
}
