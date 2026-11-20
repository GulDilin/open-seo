/* eslint-disable max-lines -- every snapshot read query for the feature in one module; the trend, summary, matrix, and retry reads share the run/snapshot scoping idioms */
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  min,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  rankCheckRuns,
  rankSnapshots,
  rankTrackingConfigs,
  rankTrackingKeywords,
} from "@/db/schema";
import { toRankTrackingTimestamp } from "@/server/features/rank-tracking/rankTrackingTimestamps";
import type { RankTrackingConfig } from "@/types/schemas/rank-tracking";

function completedRunIdsForConfig(configId: string) {
  return db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
      ),
    );
}

function cutoffTimestamp(sinceDays: number): string {
  return toRankTrackingTimestamp(
    new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000),
  );
}

/** Best position each keyword has had on any device across completed runs. */
export async function getBestPositionsForKeywords(configId: string) {
  return db
    .select({
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      position: min(rankSnapshots.position),
    })
    .from(rankSnapshots)
    .where(inArray(rankSnapshots.runId, completedRunIdsForConfig(configId)))
    .groupBy(rankSnapshots.trackingKeywordId);
}

/**
 * Flat per-keyword position series across completed runs, ordered oldest first.
 * `null` position = checked but not found within serpDepth (a real event, not a
 * missing check). The client pivots these rows per device.
 */
export async function getKeywordHistory(
  configId: string,
  trackingKeywordId: string,
  sinceDays: number,
) {
  return db
    .select({
      device: rankSnapshots.device,
      checkedAt: rankSnapshots.checkedAt,
      position: rankSnapshots.position,
    })
    .from(rankSnapshots)
    .where(
      and(
        inArray(rankSnapshots.runId, completedRunIdsForConfig(configId)),
        eq(rankSnapshots.trackingKeywordId, trackingKeywordId),
        gte(rankSnapshots.checkedAt, cutoffTimestamp(sinceDays)),
      ),
    )
    .orderBy(asc(rankSnapshots.checkedAt));
}

/**
 * Per-run keyword-position distribution for one device, oldest first. Grouped
 * by runId (not checkedAt — snapshots in a run don't share an exact insert
 * time); the run's startedAt is the x-axis timestamp. The buckets are disjoint
 * and cover every tracked keyword: a position past 20, or null (not found in
 * the tracked depth), falls into "not ranking" (derived from `total`), and a
 * keyword whose check failed has no row, so it is `keywordsTotal - total`.
 */
export async function getConfigTrend(
  configId: string,
  device: "desktop" | "mobile",
  sinceDays: number,
) {
  return db
    .select({
      runId: rankSnapshots.runId,
      checkedAt: rankCheckRuns.startedAt,
      keywordsTotal: rankCheckRuns.keywordsTotal,
      total: count(),
      top3: sql<number>`sum(case when ${rankSnapshots.position} between 1 and 3 then 1 else 0 end)`,
      top4to10: sql<number>`sum(case when ${rankSnapshots.position} between 4 and 10 then 1 else 0 end)`,
      top11to20: sql<number>`sum(case when ${rankSnapshots.position} between 11 and 20 then 1 else 0 end)`,
    })
    .from(rankSnapshots)
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
        eq(rankCheckRuns.isSubsetRun, false),
        eq(rankSnapshots.device, device),
        // Filter on the run, not the snapshot: a run that spans the cutoff
        // must keep all its rows, or they would count as not checked.
        gte(rankCheckRuns.startedAt, cutoffTimestamp(sinceDays)),
      ),
    )
    .groupBy(
      rankSnapshots.runId,
      rankCheckRuns.startedAt,
      rankCheckRuns.keywordsTotal,
    )
    .orderBy(asc(rankCheckRuns.startedAt));
}

/**
 * Recent per-keyword positions for one device as a flat list, for the "by date"
 * history matrix. Bounded to the last `runLimit` completed runs; the client
 * pivots these into keyword rows × run (date) columns.
 */
export async function getPositionMatrix(
  configId: string,
  device: "desktop" | "mobile",
  runLimit: number,
) {
  const recentRunIds = db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
        eq(rankCheckRuns.isSubsetRun, false),
      ),
    )
    .orderBy(desc(rankCheckRuns.startedAt))
    .limit(runLimit);

  return db
    .select({
      runId: rankSnapshots.runId,
      checkedAt: rankCheckRuns.startedAt,
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      position: rankSnapshots.position,
    })
    .from(rankSnapshots)
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .where(
      and(
        inArray(rankSnapshots.runId, recentRunIds),
        eq(rankSnapshots.device, device),
      ),
    )
    .orderBy(asc(rankCheckRuns.startedAt));
}

/**
 * Pick one snapshot per keyword+device from completed runs, using SQL GROUP BY
 * + self-join instead of loading all snapshots into JS memory.
 *
 * No keywordIds needed — scoped to the config via a completed-runs subquery,
 * so subset runs are included automatically.
 */
export async function getSnapshotsForConfig(
  configId: string,
  opts: { beforeDate?: string; order: "latest" | "earliest" },
) {
  const completedRunIds = db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
      ),
    );

  const aggFn = opts.order === "latest" ? max : min;

  const conditions = [inArray(rankSnapshots.runId, completedRunIds)];
  if (opts.beforeDate) {
    conditions.push(lte(rankSnapshots.checkedAt, opts.beforeDate));
  }

  const grouped = db
    .select({
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      device: rankSnapshots.device,
      targetCheckedAt: aggFn(rankSnapshots.checkedAt).as("target_checked_at"),
    })
    .from(rankSnapshots)
    .where(and(...conditions))
    .groupBy(rankSnapshots.trackingKeywordId, rankSnapshots.device)
    .as("grouped");

  return db
    .select({
      id: rankSnapshots.id,
      runId: rankSnapshots.runId,
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      keyword: rankSnapshots.keyword,
      device: rankSnapshots.device,
      position: rankSnapshots.position,
      url: rankSnapshots.url,
      serpFeatures: rankSnapshots.serpFeatures,
      checkedAt: rankSnapshots.checkedAt,
    })
    .from(rankSnapshots)
    .innerJoin(
      grouped,
      and(
        eq(rankSnapshots.trackingKeywordId, grouped.trackingKeywordId),
        eq(rankSnapshots.device, grouped.device),
        eq(rankSnapshots.checkedAt, grouped.targetCheckedAt),
      ),
    )
    .where(inArray(rankSnapshots.runId, completedRunIds));
}

export async function getLatestSnapshotsForKeywords(configId: string) {
  return getSnapshotsForConfig(configId, { order: "latest" });
}

type ProjectTrendFilters = {
  searchEngine?: RankTrackingConfig["searchEngine"];
  /** null locationName = the national market; absent = any market. */
  market?: { locationCode: number; locationName: string | null };
};

/**
 * Cross-config keyword-position distribution per day, oldest first — the
 * project-level visibility chart. For each config only its latest full
 * (completed, non-subset) run of the day counts, so a re-run can't double a
 * day. Buckets are disjoint (1 / 2–5 / 6–10 / 11–50); positions past 50 or
 * null land in "not in top 50" (derived from total by the caller) and
 * `pages` counts distinct ranking URLs across the aggregated runs.
 *
 * Two queries, not one: `keywordsTotal` is a per-run constant, so summing it
 * across a run's snapshot fan-out (one row per keyword) would multiply it by
 * the snapshot count. The buckets/pages aggregate snapshots; the totals
 * aggregate one row per run; this function merges them by day.
 */
export async function getProjectTrend(
  input: {
    projectId: string;
    device: "desktop" | "mobile";
    sinceDays: number;
  } & ProjectTrendFilters,
) {
  // Stage 1: the latest full completed run per config per day. substr on the
  // ISO text timestamp works in both dialects (times are stored as text).
  const latestRuns = db
    .select({
      configId: rankCheckRuns.configId,
      day: sql<string>`substr(${rankCheckRuns.startedAt}, 1, 10)`.as("day"),
      latestStartedAt: max(rankCheckRuns.startedAt).as("latest_started_at"),
    })
    .from(rankCheckRuns)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .where(
      and(
        eq(rankCheckRuns.projectId, input.projectId),
        eq(rankCheckRuns.status, "completed"),
        eq(rankCheckRuns.isSubsetRun, false),
        gte(rankCheckRuns.startedAt, cutoffTimestamp(input.sinceDays)),
        input.searchEngine
          ? eq(rankTrackingConfigs.searchEngine, input.searchEngine)
          : undefined,
        input.market
          ? and(
              eq(rankTrackingConfigs.locationCode, input.market.locationCode),
              input.market.locationName === null
                ? isNull(rankTrackingConfigs.locationName)
                : eq(
                    rankTrackingConfigs.locationName,
                    input.market.locationName,
                  ),
            )
          : undefined,
      ),
    )
    .groupBy(
      rankCheckRuns.configId,
      sql`substr(${rankCheckRuns.startedAt}, 1, 10)`,
    )
    .as("latest_runs");

  const matchedRun = and(
    eq(rankCheckRuns.configId, latestRuns.configId),
    eq(rankCheckRuns.startedAt, latestRuns.latestStartedAt),
    eq(rankCheckRuns.status, "completed"),
    eq(rankCheckRuns.isSubsetRun, false),
  );

  // One row per run: keywordsTotal without the snapshot fan-out.
  const runsPerDay = await db
    .select({
      day: latestRuns.day,
      keywordsTotal: rankCheckRuns.keywordsTotal,
    })
    .from(latestRuns)
    .innerJoin(rankCheckRuns, matchedRun);

  const bucketsPerDay = await db
    .select({
      day: latestRuns.day,
      total: count(),
      top1: sql<number>`sum(case when ${rankSnapshots.position} = 1 then 1 else 0 end)`,
      top2to5: sql<number>`sum(case when ${rankSnapshots.position} between 2 and 5 then 1 else 0 end)`,
      top6to10: sql<number>`sum(case when ${rankSnapshots.position} between 6 and 10 then 1 else 0 end)`,
      top11to50: sql<number>`sum(case when ${rankSnapshots.position} between 11 and 50 then 1 else 0 end)`,
      pages: countDistinct(rankSnapshots.url),
    })
    .from(latestRuns)
    .innerJoin(rankCheckRuns, matchedRun)
    .innerJoin(
      rankSnapshots,
      and(
        eq(rankSnapshots.runId, rankCheckRuns.id),
        eq(rankSnapshots.device, input.device),
      ),
    )
    .groupBy(sql`day`)
    .orderBy(sql`day`);

  const keywordsTotalByDay = new Map<string, number>();
  for (const row of runsPerDay) {
    keywordsTotalByDay.set(
      row.day,
      (keywordsTotalByDay.get(row.day) ?? 0) + (row.keywordsTotal ?? 0),
    );
  }
  return bucketsPerDay.map((row) => ({
    ...row,
    keywordsTotal: keywordsTotalByDay.get(row.day) ?? 0,
  }));
}

/**
 * Current project visibility: the same buckets as getProjectTrend, but from
 * each keyword's LATEST snapshot (any completed run — subset runs included,
 * same scope as getSnapshotsForConfig) instead of a day-bucketed history, so
 * the numbers exist as soon as any check has run, independent of the chart's
 * history window. Unlike the trend, only ACTIVE configs count: archived
 * trackers keep their chart history but drop out of the current state, the
 * same universe the engine/market switches are built from.
 */
export async function getProjectSummary(
  input: {
    projectId: string;
    device: "desktop" | "mobile";
  } & ProjectTrendFilters,
) {
  const configScope = and(
    eq(rankTrackingConfigs.projectId, input.projectId),
    eq(rankTrackingConfigs.isActive, true),
    input.searchEngine
      ? eq(rankTrackingConfigs.searchEngine, input.searchEngine)
      : undefined,
    input.market
      ? and(
          eq(rankTrackingConfigs.locationCode, input.market.locationCode),
          input.market.locationName === null
            ? isNull(rankTrackingConfigs.locationName)
            : eq(rankTrackingConfigs.locationName, input.market.locationName),
        )
      : undefined,
  );

  const scopedConfigIds = db
    .select({ id: rankTrackingConfigs.id })
    .from(rankTrackingConfigs)
    .where(configScope);

  // Snapshots outlive their keyword (no FK, cleanup is best-effort), so
  // scope through the live keyword rows — a removed keyword's last position
  // must not surface as a ghost in the current state.
  const scopedKeywordIds = db
    .select({ id: rankTrackingKeywords.id })
    .from(rankTrackingKeywords)
    .where(inArray(rankTrackingKeywords.configId, scopedConfigIds));

  const scopedRunIds = db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.status, "completed"),
        inArray(rankCheckRuns.configId, scopedConfigIds),
      ),
    );

  // Latest-per-keyword via GROUP BY + self-join, the getSnapshotsForConfig
  // idiom; the device is fixed in WHERE, so keywordId alone groups.
  const latestPerKeyword = db
    .select({
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      targetCheckedAt: max(rankSnapshots.checkedAt).as("target_checked_at"),
    })
    .from(rankSnapshots)
    .where(
      and(
        inArray(rankSnapshots.runId, scopedRunIds),
        inArray(rankSnapshots.trackingKeywordId, scopedKeywordIds),
        eq(rankSnapshots.device, input.device),
      ),
    )
    .groupBy(rankSnapshots.trackingKeywordId)
    .as("latest_per_keyword");

  const [buckets] = await db
    .select({
      total: count(),
      top1: sql<number>`sum(case when ${rankSnapshots.position} = 1 then 1 else 0 end)`,
      top2to5: sql<number>`sum(case when ${rankSnapshots.position} between 2 and 5 then 1 else 0 end)`,
      top6to10: sql<number>`sum(case when ${rankSnapshots.position} between 6 and 10 then 1 else 0 end)`,
      top11to50: sql<number>`sum(case when ${rankSnapshots.position} between 11 and 50 then 1 else 0 end)`,
      pages: countDistinct(rankSnapshots.url),
    })
    .from(rankSnapshots)
    .innerJoin(
      latestPerKeyword,
      and(
        eq(rankSnapshots.trackingKeywordId, latestPerKeyword.trackingKeywordId),
        eq(rankSnapshots.checkedAt, latestPerKeyword.targetCheckedAt),
      ),
    )
    .where(
      and(
        inArray(rankSnapshots.runId, scopedRunIds),
        inArray(rankSnapshots.trackingKeywordId, scopedKeywordIds),
        eq(rankSnapshots.device, input.device),
      ),
    );

  // Keywords currently tracked by the in-scope configs — including never
  // checked ones; the caller derives notChecked from the difference.
  const [keywords] = await db
    .select({ count: count() })
    .from(rankTrackingKeywords)
    .where(inArray(rankTrackingKeywords.configId, scopedConfigIds));

  return { ...buckets, keywordsTotal: keywords?.count ?? 0 };
}

export async function getSnapshotsBeforeDate(
  configId: string,
  beforeDate: string,
) {
  return getSnapshotsForConfig(configId, { beforeDate, order: "latest" });
}

export async function getEarliestSnapshotsForKeywords(
  configId: string,
  keywordIds: string[],
) {
  if (keywordIds.length === 0) return [];

  const completedRunIds = db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
      ),
    );

  // D1 caps bound parameters at 100 per statement. The query binds N keyword
  // IDs plus 4 params from the completedRunIds subquery (referenced twice).
  // (Postgres allows far more, but the chunking is harmless there.)
  const CHUNK_SIZE = 90;
  const allResults: Awaited<ReturnType<typeof getSnapshotsForConfig>> = [];

  for (let i = 0; i < keywordIds.length; i += CHUNK_SIZE) {
    const chunk = keywordIds.slice(i, i + CHUNK_SIZE);

    const grouped = db
      .select({
        trackingKeywordId: rankSnapshots.trackingKeywordId,
        device: rankSnapshots.device,
        targetCheckedAt: min(rankSnapshots.checkedAt).as("target_checked_at"),
      })
      .from(rankSnapshots)
      .where(
        and(
          inArray(rankSnapshots.runId, completedRunIds),
          inArray(rankSnapshots.trackingKeywordId, chunk),
        ),
      )
      .groupBy(rankSnapshots.trackingKeywordId, rankSnapshots.device)
      .as("grouped");

    const rows = await db
      .select({
        id: rankSnapshots.id,
        runId: rankSnapshots.runId,
        trackingKeywordId: rankSnapshots.trackingKeywordId,
        keyword: rankSnapshots.keyword,
        device: rankSnapshots.device,
        position: rankSnapshots.position,
        url: rankSnapshots.url,
        serpFeatures: rankSnapshots.serpFeatures,
        checkedAt: rankSnapshots.checkedAt,
      })
      .from(rankSnapshots)
      .innerJoin(
        grouped,
        and(
          eq(rankSnapshots.trackingKeywordId, grouped.trackingKeywordId),
          eq(rankSnapshots.device, grouped.device),
          eq(rankSnapshots.checkedAt, grouped.targetCheckedAt),
        ),
      )
      .where(inArray(rankSnapshots.runId, completedRunIds));

    allResults.push(...rows);
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// Domain overview: per-engine aggregates over the ACTIVE trackers whose domain
// is the project's own domain. Same scoping idioms as getProjectTrend /
// getProjectSummary, with the engine as an extra grouping dimension.
// ---------------------------------------------------------------------------

type DomainTrackerScope = {
  projectId: string;
  domain: string;
  device: "desktop" | "mobile";
};

function activeDomainConfigIds(scope: DomainTrackerScope) {
  return db
    .select({ id: rankTrackingConfigs.id })
    .from(rankTrackingConfigs)
    .where(
      and(
        eq(rankTrackingConfigs.projectId, scope.projectId),
        eq(rankTrackingConfigs.isActive, true),
        eq(rankTrackingConfigs.domain, scope.domain),
      ),
    );
}

/** Latest snapshot per keyword (fixed device), the getProjectSummary idiom,
 *  as a joinable subquery. Shared by the summary and top-pages aggregates. */
function latestSnapshotsPerKeyword(scope: DomainTrackerScope) {
  const scopedRunIds = db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.status, "completed"),
        inArray(rankCheckRuns.configId, activeDomainConfigIds(scope)),
      ),
    );

  const scopedKeywordIds = db
    .select({ id: rankTrackingKeywords.id })
    .from(rankTrackingKeywords)
    .where(
      inArray(rankTrackingKeywords.configId, activeDomainConfigIds(scope)),
    );

  const latestPerKeyword = db
    .select({
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      targetCheckedAt: max(rankSnapshots.checkedAt).as("target_checked_at"),
    })
    .from(rankSnapshots)
    .where(
      and(
        inArray(rankSnapshots.runId, scopedRunIds),
        inArray(rankSnapshots.trackingKeywordId, scopedKeywordIds),
        eq(rankSnapshots.device, scope.device),
      ),
    )
    .groupBy(rankSnapshots.trackingKeywordId)
    .as("latest_per_keyword");

  return { latestPerKeyword, scopedRunIds, scopedKeywordIds };
}

/**
 * Per-engine, per-day visibility buckets — getProjectTrend scoped to the
 * domain's active trackers and grouped by engine too, one row per engine+day
 * oldest first. `keywordsTotal` is merged in from a second one-row-per-run
 * query so the snapshot fan-out can't multiply it.
 */
export async function getDomainEngineTrends(
  scope: DomainTrackerScope & { sinceDays: number },
) {
  const latestRuns = db
    .select({
      configId: rankCheckRuns.configId,
      day: sql<string>`substr(${rankCheckRuns.startedAt}, 1, 10)`.as("day"),
      latestStartedAt: max(rankCheckRuns.startedAt).as("latest_started_at"),
    })
    .from(rankCheckRuns)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .where(
      and(
        eq(rankCheckRuns.projectId, scope.projectId),
        eq(rankCheckRuns.status, "completed"),
        eq(rankCheckRuns.isSubsetRun, false),
        gte(rankCheckRuns.startedAt, cutoffTimestamp(scope.sinceDays)),
        eq(rankTrackingConfigs.domain, scope.domain),
        eq(rankTrackingConfigs.isActive, true),
      ),
    )
    .groupBy(
      rankCheckRuns.configId,
      sql`substr(${rankCheckRuns.startedAt}, 1, 10)`,
    )
    .as("latest_runs");

  const matchedRun = and(
    eq(rankCheckRuns.configId, latestRuns.configId),
    eq(rankCheckRuns.startedAt, latestRuns.latestStartedAt),
    eq(rankCheckRuns.status, "completed"),
    eq(rankCheckRuns.isSubsetRun, false),
  );

  const runsPerDay = await db
    .select({
      day: latestRuns.day,
      searchEngine: rankTrackingConfigs.searchEngine,
      keywordsTotal: rankCheckRuns.keywordsTotal,
    })
    .from(latestRuns)
    .innerJoin(rankCheckRuns, matchedRun)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    );

  const bucketsPerDay = await db
    .select({
      day: latestRuns.day,
      searchEngine: rankTrackingConfigs.searchEngine,
      total: count(),
      top1: sql<number>`sum(case when ${rankSnapshots.position} = 1 then 1 else 0 end)`,
      top2to5: sql<number>`sum(case when ${rankSnapshots.position} between 2 and 5 then 1 else 0 end)`,
      top6to10: sql<number>`sum(case when ${rankSnapshots.position} between 6 and 10 then 1 else 0 end)`,
      top11to50: sql<number>`sum(case when ${rankSnapshots.position} between 11 and 50 then 1 else 0 end)`,
      pages: countDistinct(rankSnapshots.url),
    })
    .from(latestRuns)
    .innerJoin(rankCheckRuns, matchedRun)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .innerJoin(
      rankSnapshots,
      and(
        eq(rankSnapshots.runId, rankCheckRuns.id),
        eq(rankSnapshots.device, scope.device),
      ),
    )
    .groupBy(sql`day`, rankTrackingConfigs.searchEngine)
    .orderBy(sql`day`);

  const keywordsTotalByKey = new Map<string, number>();
  for (const row of runsPerDay) {
    const key = `${row.searchEngine}|${row.day}`;
    keywordsTotalByKey.set(
      key,
      (keywordsTotalByKey.get(key) ?? 0) + (row.keywordsTotal ?? 0),
    );
  }
  return bucketsPerDay.map((row) => ({
    ...row,
    keywordsTotal:
      keywordsTotalByKey.get(`${row.searchEngine}|${row.day}`) ?? 0,
  }));
}

/**
 * Per-engine current-state buckets and tracked-keyword totals, from each
 * keyword's latest snapshot — the getProjectSummary shape grouped by engine.
 * Buckets and keyword counts come back separately: a keyword with no snapshot
 * yet appears only in the counts (the caller derives notChecked).
 */
export async function getDomainEngineSummaries(scope: DomainTrackerScope) {
  const { latestPerKeyword, scopedRunIds, scopedKeywordIds } =
    latestSnapshotsPerKeyword(scope);

  const buckets = await db
    .select({
      searchEngine: rankTrackingConfigs.searchEngine,
      total: count(),
      top1: sql<number>`sum(case when ${rankSnapshots.position} = 1 then 1 else 0 end)`,
      top2to5: sql<number>`sum(case when ${rankSnapshots.position} between 2 and 5 then 1 else 0 end)`,
      top6to10: sql<number>`sum(case when ${rankSnapshots.position} between 6 and 10 then 1 else 0 end)`,
      top11to50: sql<number>`sum(case when ${rankSnapshots.position} between 11 and 50 then 1 else 0 end)`,
      pages: countDistinct(rankSnapshots.url),
    })
    .from(rankSnapshots)
    .innerJoin(
      latestPerKeyword,
      and(
        eq(rankSnapshots.trackingKeywordId, latestPerKeyword.trackingKeywordId),
        eq(rankSnapshots.checkedAt, latestPerKeyword.targetCheckedAt),
      ),
    )
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .where(
      and(
        inArray(rankSnapshots.runId, scopedRunIds),
        inArray(rankSnapshots.trackingKeywordId, scopedKeywordIds),
        eq(rankSnapshots.device, scope.device),
      ),
    )
    .groupBy(rankTrackingConfigs.searchEngine);

  const keywordsPerEngine = await db
    .select({
      searchEngine: rankTrackingConfigs.searchEngine,
      count: count(),
    })
    .from(rankTrackingKeywords)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankTrackingKeywords.configId, rankTrackingConfigs.id),
    )
    .where(inArray(rankTrackingKeywords.configId, activeDomainConfigIds(scope)))
    .groupBy(rankTrackingConfigs.searchEngine);

  return { buckets, keywordsPerEngine };
}

/**
 * Per-engine top ranking pages: for each keyword's latest snapshot that holds
 * a position AND a URL, grouped by engine+page — how many queries land on the
 * page and the best of their positions. Ordered by query count; the caller
 * slices the per-engine top list.
 */
export async function getDomainEngineTopPages(scope: DomainTrackerScope) {
  const { latestPerKeyword, scopedRunIds, scopedKeywordIds } =
    latestSnapshotsPerKeyword(scope);

  return db
    .select({
      searchEngine: rankTrackingConfigs.searchEngine,
      url: rankSnapshots.url,
      keywords: count(),
      bestPosition: min(rankSnapshots.position),
    })
    .from(rankSnapshots)
    .innerJoin(
      latestPerKeyword,
      and(
        eq(rankSnapshots.trackingKeywordId, latestPerKeyword.trackingKeywordId),
        eq(rankSnapshots.checkedAt, latestPerKeyword.targetCheckedAt),
      ),
    )
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .where(
      and(
        inArray(rankSnapshots.runId, scopedRunIds),
        inArray(rankSnapshots.trackingKeywordId, scopedKeywordIds),
        eq(rankSnapshots.device, scope.device),
        isNotNull(rankSnapshots.position),
        isNotNull(rankSnapshots.url),
      ),
    )
    .groupBy(rankTrackingConfigs.searchEngine, rankSnapshots.url)
    .orderBy(sql`count(*) desc, min(${rankSnapshots.position}) asc`);
}
