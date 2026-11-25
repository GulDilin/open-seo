import { waitUntil } from "cloudflare:workers";
import { getAhrefsDomainRating } from "@/server/lib/ahrefs";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CreditFeature } from "@/shared/billing-credit-features";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { buildRankedKeywordsScopeFilter } from "@/server/lib/dataforseo/researchScopeFilters";
import { joinClauses } from "@/server/lib/dataforseo/filters";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import type { ResearchScope } from "@/shared/researchScope";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import { getKeywordsPage } from "@/server/features/domain/services/domainKeywordsPage";
import { getPagesPage } from "@/server/features/domain/services/domainPagesPage";
import { BacklinkSnapshotRepository } from "@/server/features/domain/repositories/BacklinkSnapshotRepository";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import { YandexConnectionRepository } from "@/server/features/yandex/repositories/YandexConnectionRepository";
import { isExpectedGrantFailure } from "@/server/features/yandex/services/YandexWebmasterService";
import { createYandexWebmasterClient } from "@/server/lib/yandexWebmasterClient";

// Lets a caller attribute spend to its own feature (e.g. the SAM agent). Applied
// to the DataForSEO call, not the cache key, so cached results are shared
// across callers.
type MeteringOverrides = {
  creditFeature?: CreditFeature;
};

/** Domain overview data is refreshed every 12 hours. */
const DOMAIN_OVERVIEW_TTL_SECONDS = 12 * 60 * 60;

const domainOverviewResultSchema = z.object({
  domain: z.string(),
  organicTraffic: z.number().nullable(),
  organicKeywords: z.number().nullable(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  hasData: z.boolean(),
  fetchedAt: z.string(),
});

type DomainOverviewResult = z.infer<typeof domainOverviewResultSchema> & {
  /** Requested research scope, echoed for display. */
  scope: ResearchScope;
  displayTarget: string;
};

/**
 * Backlinks metrics are merged from the Backlinks page's cached summary for
 * the same hostname — a cache read only, so the overview never spends a
 * DataForSEO call on them. Merged on every read (not stored in the overview
 * cache entry) so they follow the summary's 6h refresh cycle, not the
 * overview's 12h one. Null until the domain-rating card (domain page and
 * dashboard) or the Backlinks page fills the cache.
 */
async function applyCachedBacklinksSummary(
  result: DomainOverviewResult,
  domain: string,
  billingCustomer: BillingCustomerContext,
): Promise<DomainOverviewResult> {
  const overview = await BacklinksService.cachedProfileOverview(
    { target: domain, scope: "subdomains" },
    billingCustomer,
  );
  return {
    ...result,
    backlinks: overview?.summary.backlinks ?? null,
    referringDomains: overview?.summary.referringDomains ?? null,
  };
}

async function getOverview(
  input: {
    projectId: string;
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
  metering: MeteringOverrides = {},
): Promise<DomainOverviewResult> {
  const target = parseResearchTargetOrThrow(input.domain, input.scope);
  const domain = target.hostname;

  // domain_rank_overview has no filters and always covers the hostname plus
  // all of its subdomains, so every scope shares one cache entry per hostname.
  // Callers label the metrics as domain-wide for narrower scopes.
  const cacheKey = await buildCacheKey("domain:overview", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const cachedRaw = await getCached(cacheKey);
  const cached = domainOverviewResultSchema.safeParse(cachedRaw);
  if (cached.success && cached.data.hasData) {
    return applyCachedBacklinksSummary(
      { ...cached.data, scope: target.scope, displayTarget: target.display },
      domain,
      billingCustomer,
    );
  }

  const nowIso = new Date().toISOString();
  const dataforseo = createDataforseoClient(billingCustomer);

  const metricsResponse = await dataforseo.domain.rankOverview({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    ...metering,
  });

  const metrics = metricsResponse[0];

  const organicTraffic =
    metrics?.metrics?.organic?.etv != null
      ? Math.round(metrics.metrics.organic.etv)
      : null;
  const organicKeywords =
    metrics?.metrics?.organic?.count != null
      ? Math.round(metrics.metrics.organic.count)
      : null;

  const stored: z.infer<typeof domainOverviewResultSchema> = {
    domain,
    organicTraffic,
    organicKeywords,
    backlinks: null,
    referringDomains: null,
    hasData: organicKeywords != null && organicKeywords > 0,
    fetchedAt: nowIso,
  };

  if (stored.hasData) {
    // waitUntil, not void: workerd cancels unregistered pending I/O once the
    // response is sent, so a fire-and-forget put never persists the cache.
    waitUntil(
      setCached(cacheKey, stored, DOMAIN_OVERVIEW_TTL_SECONDS).catch(
        (error) => {
          console.error("domain.overview.cache-write failed:", error);
        },
      ),
    );
  }

  return applyCachedBacklinksSummary(
    { ...stored, scope: target.scope, displayTarget: target.display },
    domain,
    billingCustomer,
  );
}

async function getSuggestedKeywords(
  input: {
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
    organizationId: string;
    projectId: string;
  },
  billingCustomer: BillingCustomerContext,
  metering: MeteringOverrides = {},
): Promise<
  Array<{
    keyword: string;
    position: number | null;
    searchVolume: number | null;
    traffic: number | null;
    cpc: number | null;
    keywordDifficulty: number | null;
  }>
> {
  const target = parseResearchTargetOrThrow(input.domain, input.scope);
  const scopeFilter = buildRankedKeywordsScopeFilter(target);

  const cacheKey = await buildCacheKey("domain:keyword-suggestions", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain: target.hostname,
    scope: target.scope,
    path: target.path,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const cachedRaw = await getCached(cacheKey);
  const cached = z
    .array(
      z.object({
        keyword: z.string(),
        position: z.number().nullable(),
        searchVolume: z.number().nullable(),
        traffic: z.number().nullable(),
        cpc: z.number().nullable(),
        keywordDifficulty: z.number().nullable(),
      }),
    )
    .safeParse(cachedRaw);
  if (cached.success && cached.data.length > 0) {
    return cached.data;
  }

  const dataforseo = createDataforseoClient(billingCustomer);

  const rankedKeywordsResponse = await dataforseo.domain.rankedKeywords({
    target: target.hostname,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: 100,
    orderBy: ["ranked_serp_element.serp_item.etv,desc"],
    filters:
      scopeFilter.clauses.length > 0
        ? joinClauses(scopeFilter.clauses, "and")
        : undefined,
    ...metering,
  });

  const keywords = rankedKeywordsResponse.items
    .map((item) => mapKeywordItem(item))
    .filter(
      (item): item is NonNullable<ReturnType<typeof mapKeywordItem>> =>
        item != null,
    )
    .map((item) => ({
      keyword: item.keyword,
      position: item.position,
      searchVolume: item.searchVolume,
      traffic: item.traffic,
      cpc: item.cpc,
      keywordDifficulty: item.keywordDifficulty,
    }));

  if (keywords.length > 0) {
    waitUntil(
      setCached(cacheKey, keywords, DOMAIN_OVERVIEW_TTL_SECONDS).catch(
        (error) => {
          console.error(
            "domain.keyword-suggestions.cache-write failed:",
            error,
          );
        },
      ),
    );
  }

  return keywords;
}

/** The project website's Yandex SQI (ИКС). First-party Webmaster data — works
 *  without the DataForSEO key. ИКС changes rarely, so a value is served from
 *  the R2 cache for a day before Yandex is asked again. */
const PROJECT_SQI_TTL_SECONDS = 24 * 60 * 60;

const projectSqiCacheSchema = z.object({
  sqi: z.number().nullable(),
  fetchedAt: z.string(),
});

type ProjectSqiResult = {
  connected: boolean;
  hostUrl: string | null;
  sqi: number | null;
  /** Why live data is missing when it is — dead grant etc. Rendered instead
   *  of a silent dash. */
  unavailableReason: string | null;
};

async function getProjectSqi(input: {
  projectId: string;
}): Promise<ProjectSqiResult> {
  const connection = await YandexConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) {
    return {
      connected: false,
      hostUrl: null,
      sqi: null,
      unavailableReason: null,
    };
  }

  const cacheKey = await buildCacheKey("domain:sqi", {
    projectId: input.projectId,
    hostId: connection.hostId,
  });
  const cached = projectSqiCacheSchema.safeParse(await getCached(cacheKey));
  if (cached.success) {
    return {
      connected: true,
      hostUrl: connection.hostUrl,
      sqi: cached.data.sqi,
      unavailableReason: null,
    };
  }

  try {
    const sqi = await createYandexWebmasterClient({
      userId: connection.connectedByUserId,
      yandexAccountId: connection.yandexAccountId ?? undefined,
    }).getSqi(connection.hostId);
    waitUntil(
      setCached(
        cacheKey,
        { sqi, fetchedAt: new Date().toISOString() },
        PROJECT_SQI_TTL_SECONDS,
      ).catch((error) => {
        console.error("domain.sqi.cache-write failed:", error);
      }),
    );
    return {
      connected: true,
      hostUrl: connection.hostUrl,
      sqi,
      unavailableReason: null,
    };
  } catch (error) {
    // A dead grant surfaces as disconnected with the reason — the number
    // would silently stop moving otherwise.
    if (isExpectedGrantFailure(error)) {
      return {
        connected: false,
        hostUrl: connection.hostUrl,
        sqi: null,
        unavailableReason:
          error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

/** A snapshot older than this is considered stale and refreshed on demand. */
const DOMAIN_RATING_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Where the displayed domain rating came from, so the UI can label it. */
type DomainRatingSource = "dataforseo" | "ahrefs";

type ProjectDomainRating = {
  domain: string | null;
  rank: number | null;
  source: DomainRatingSource | null;
  /** Why the rank is empty — the UI shows it instead of a bare dash. */
  reason: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error);
}

/**
 * Ahrefs-style domain rating for the project's own website: DataForSEO's
 * backlinks rank, with the free keyless Ahrefs DR as the fallback. Serves the
 * latest backlink snapshot while it is fresh and for the current domain;
 * otherwise refreshes through the same cached overview lookup the Backlinks
 * page uses. Never throws — an unavailable provider becomes a reason.
 */
async function getProjectDomainRating(
  input: { projectId: string; domain: string | null },
  billingCustomer: BillingCustomerContext,
): Promise<ProjectDomainRating> {
  const domain = input.domain?.trim() ?? "";
  if (!domain) return { domain: null, rank: null, source: null, reason: null };

  const snapshot = await BacklinkSnapshotRepository.getLatestForProject(
    input.projectId,
  );
  const capturedMs = snapshot ? Date.parse(snapshot.capturedAt) : Number.NaN;
  if (
    snapshot &&
    snapshot.domain === domain &&
    snapshot.rank != null &&
    Number.isFinite(capturedMs) &&
    Date.now() - capturedMs < DOMAIN_RATING_SNAPSHOT_MAX_AGE_MS
  ) {
    return { domain, rank: snapshot.rank, source: "dataforseo", reason: null };
  }

  // The first provider failure wins: DataForSEO is the primary source, so its
  // error is the more actionable one to surface.
  let firstError: unknown = null;
  try {
    // Whole site, subdomains included — the same target snapshots were
    // captured for. The overview is R2-cached, shared with the Backlinks page.
    const { overview } = await BacklinksService.profileOverview(
      { target: domain, scope: "subdomains" },
      billingCustomer,
    );
    if (overview.summary.rank != null) {
      return {
        domain,
        rank: overview.summary.rank,
        source: "dataforseo",
        reason: null,
      };
    }
  } catch (error) {
    firstError = error;
  }

  // DataForSEO had no rank (failed or rated nothing) — fall back to the free
  // Ahrefs DR so the rating stays a real number whenever one source works.
  try {
    const dr = await getAhrefsDomainRating(domain);
    if (dr != null) return { domain, rank: dr, source: "ahrefs", reason: null };
  } catch (error) {
    if (firstError === null) firstError = error;
  }

  return {
    domain,
    rank: null,
    source: null,
    reason:
      firstError != null
        ? errorMessage(firstError)
        : "No rating for this domain yet — the Backlinks page refreshes it",
  };
}

export const DomainService = {
  getOverview,
  getSuggestedKeywords,
  getKeywordsPage,
  getPagesPage,
  getProjectDomainRating,
  getProjectSqi,
} as const;
