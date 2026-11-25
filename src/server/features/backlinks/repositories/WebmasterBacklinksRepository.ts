import { and, desc, eq, gte, sql } from "drizzle-orm";
import { reverse } from "remeda";
import { db } from "@/db";
import {
  webmasterBacklinkSamples,
  webmasterBacklinkSnapshots,
} from "@/db/schema";

// Webmasters whose link data lands in these tables. Bing Webmaster writes
// through the Bing feature's service; Yandex through WebmasterBacklinksService.
type WebmasterBacklinkSource = "yandex_webmaster" | "bing_webmaster";

/** Upsert one dated count per history point. Re-collecting the same date
 *  refreshes the count and bumps capturedAt (the staleness marker). */
async function saveSnapshots(
  rows: Array<{
    projectId: string;
    source: WebmasterBacklinkSource;
    date: string;
    linksTotalCount: number;
    capturedAt: string;
  }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(webmasterBacklinkSnapshots)
      .values({ id: crypto.randomUUID(), ...row })
      .onConflictDoUpdate({
        target: [
          webmasterBacklinkSnapshots.projectId,
          webmasterBacklinkSnapshots.source,
          webmasterBacklinkSnapshots.date,
        ],
        set: {
          linksTotalCount: row.linksTotalCount,
          capturedAt: row.capturedAt,
        },
      });
  }
}

/** Upsert sample links. firstSeenAt survives re-observation; lastSeenAt moves
 *  so stale samples stay identifiable. */
async function saveSamples(
  rows: Array<{
    projectId: string;
    source: WebmasterBacklinkSource;
    sourceUrl: string;
    destinationUrl: string;
    discoveryDate: string | null;
    sourceLastAccessDate: string | null;
    seenAt: string;
  }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(webmasterBacklinkSamples)
      .values({
        id: crypto.randomUUID(),
        projectId: row.projectId,
        source: row.source,
        sourceUrl: row.sourceUrl,
        destinationUrl: row.destinationUrl,
        discoveryDate: row.discoveryDate,
        sourceLastAccessDate: row.sourceLastAccessDate,
        firstSeenAt: row.seenAt,
        lastSeenAt: row.seenAt,
      })
      .onConflictDoUpdate({
        target: [
          webmasterBacklinkSamples.projectId,
          webmasterBacklinkSamples.sourceUrl,
          webmasterBacklinkSamples.destinationUrl,
        ],
        set: {
          discoveryDate: row.discoveryDate,
          sourceLastAccessDate: row.sourceLastAccessDate,
          lastSeenAt: row.seenAt,
        },
      });
  }
}

/** Dated count series (oldest first) for the trend chart. */
async function listSnapshots(
  projectId: string,
  source: WebmasterBacklinkSource,
): Promise<Array<{ date: string; linksTotalCount: number }>> {
  const rows = await db
    .select({
      date: webmasterBacklinkSnapshots.date,
      linksTotalCount: webmasterBacklinkSnapshots.linksTotalCount,
    })
    .from(webmasterBacklinkSnapshots)
    .where(
      and(
        eq(webmasterBacklinkSnapshots.projectId, projectId),
        eq(webmasterBacklinkSnapshots.source, source),
      ),
    )
    .orderBy(desc(webmasterBacklinkSnapshots.date))
    .limit(365);
  return reverse(rows);
}

/** Samples newest-discovery first, capped for the page table. */
async function listSamples(
  projectId: string,
  source: WebmasterBacklinkSource,
  limit: number,
): Promise<
  Array<{
    sourceUrl: string;
    destinationUrl: string;
    discoveryDate: string | null;
    sourceLastAccessDate: string | null;
  }>
> {
  return (
    db
      .select({
        sourceUrl: webmasterBacklinkSamples.sourceUrl,
        destinationUrl: webmasterBacklinkSamples.destinationUrl,
        discoveryDate: webmasterBacklinkSamples.discoveryDate,
        sourceLastAccessDate: webmasterBacklinkSamples.sourceLastAccessDate,
      })
      .from(webmasterBacklinkSamples)
      .where(
        and(
          eq(webmasterBacklinkSamples.projectId, projectId),
          eq(webmasterBacklinkSamples.source, source),
        ),
      )
      // Nulls last in both dialects: desc over "date < null" keeps SQLite's
      // NULLS-last default and matches Postgres only when expressed explicitly.
      .orderBy(sql`${webmasterBacklinkSamples.discoveryDate} desc nulls last`)
      .limit(limit)
  );
}

/** Samples the webmaster discovered on/after `fromDate` (UTC day), newest
 *  first. Undated samples never count as new — their age is unknown. Read
 *  only: callers that need fresh data collect through the service instead. */
async function listRecentSamples(
  projectId: string,
  source: WebmasterBacklinkSource,
  fromDate: string,
  limit: number,
): Promise<
  Array<{
    sourceUrl: string;
    destinationUrl: string;
    discoveryDate: string | null;
  }>
> {
  return db
    .select({
      sourceUrl: webmasterBacklinkSamples.sourceUrl,
      destinationUrl: webmasterBacklinkSamples.destinationUrl,
      discoveryDate: webmasterBacklinkSamples.discoveryDate,
    })
    .from(webmasterBacklinkSamples)
    .where(
      and(
        eq(webmasterBacklinkSamples.projectId, projectId),
        eq(webmasterBacklinkSamples.source, source),
        gte(webmasterBacklinkSamples.discoveryDate, fromDate),
      ),
    )
    .orderBy(desc(webmasterBacklinkSamples.discoveryDate))
    .limit(limit);
}

async function countSamples(
  projectId: string,
  source: WebmasterBacklinkSource,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(webmasterBacklinkSamples)
    .where(
      and(
        eq(webmasterBacklinkSamples.projectId, projectId),
        eq(webmasterBacklinkSamples.source, source),
      ),
    );
  return row?.count ?? 0;
}

/** When the last collect wrote anything — null when never collected. */
async function lastCollectedAt(
  projectId: string,
  source: WebmasterBacklinkSource,
): Promise<string | null> {
  const [row] = await db
    .select({ capturedAt: webmasterBacklinkSnapshots.capturedAt })
    .from(webmasterBacklinkSnapshots)
    .where(
      and(
        eq(webmasterBacklinkSnapshots.projectId, projectId),
        eq(webmasterBacklinkSnapshots.source, source),
      ),
    )
    .orderBy(desc(webmasterBacklinkSnapshots.capturedAt))
    .limit(1);
  return row?.capturedAt ?? null;
}

export const WebmasterBacklinksRepository = {
  saveSnapshots,
  saveSamples,
  listSnapshots,
  listSamples,
  listRecentSamples,
  countSamples,
  lastCollectedAt,
};
