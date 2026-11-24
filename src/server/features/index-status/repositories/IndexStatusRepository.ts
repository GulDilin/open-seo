import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  indexStatusChecks,
  indexStatusPageSources,
  indexStatusPages,
  indexStatusRuns,
} from "@/db/schema";

export type IndexStatusSource = "gsc_search" | "yandex_samples" | "audit_crawl";
export type IndexStatusEngine = "google" | "yandex";
type IndexStatusCollector = IndexStatusEngine | "audit";
export type IndexStatusVerdict = "indexed" | "not_indexed" | "likely_indexed";
export type IndexStatusEvidence =
  | "url_inspection"
  | "gsc_impressions"
  | "gsc_no_impressions"
  | "yandex_in_search"
  | "yandex_event";

export type IndexStatusCheckRow = {
  pageId: string;
  url: string;
  engine: IndexStatusEngine;
  status: IndexStatusVerdict;
  reason: string | null;
  evidence: IndexStatusEvidence;
  checkedAt: string;
};

type CheckInput = {
  pageId: string;
  engine: IndexStatusEngine;
  status: IndexStatusVerdict;
  reason: string | null;
  evidence: IndexStatusEvidence;
  checkedAt: string;
};

/** Upsert pages (one row per URL; re-observation bumps lastSeenAt only). */
async function upsertPages(
  projectId: string,
  pages: Array<{ url: string; seenAt: string }>,
): Promise<void> {
  await executeInBatches(pages, (tx, page) =>
    tx
      .insert(indexStatusPages)
      .values({
        id: crypto.randomUUID(),
        projectId,
        url: page.url,
        firstSeenAt: page.seenAt,
        lastSeenAt: page.seenAt,
      })
      .onConflictDoUpdate({
        target: [indexStatusPages.projectId, indexStatusPages.url],
        set: { lastSeenAt: page.seenAt },
      }),
  );
}

/** url → id for every stored page of the project. Collects call this after
 *  upserting to attach checks and sources. */
async function listPageIds(projectId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: indexStatusPages.id, url: indexStatusPages.url })
    .from(indexStatusPages)
    .where(eq(indexStatusPages.projectId, projectId));
  return new Map(rows.map((row) => [row.url, row.id]));
}

/** Record which source discovered a page. Re-discovery is a no-op. */
async function saveSources(
  rows: Array<{ pageId: string; source: IndexStatusSource }>,
): Promise<void> {
  await executeInBatches(rows, (tx, row) =>
    tx
      .insert(indexStatusPageSources)
      .values({ id: crypto.randomUUID(), ...row })
      .onConflictDoNothing({
        target: [indexStatusPageSources.pageId, indexStatusPageSources.source],
      }),
  );
}

/** Upsert the latest per-engine verdict for pages. Last write wins, so
 *  callers must order writes by confidence (impressions before inspections,
 *  historical events before current samples). */
async function saveChecks(rows: CheckInput[]): Promise<void> {
  await executeInBatches(rows, (tx, row) =>
    tx
      .insert(indexStatusChecks)
      .values({ id: crypto.randomUUID(), ...row })
      .onConflictDoUpdate({
        target: [indexStatusChecks.pageId, indexStatusChecks.engine],
        set: {
          status: row.status,
          reason: row.reason,
          evidence: row.evidence,
          checkedAt: row.checkedAt,
        },
      }),
  );
}

async function listChecks(projectId: string): Promise<IndexStatusCheckRow[]> {
  const rows = await db
    .select({
      pageId: indexStatusChecks.pageId,
      url: indexStatusPages.url,
      engine: indexStatusChecks.engine,
      status: indexStatusChecks.status,
      reason: indexStatusChecks.reason,
      evidence: indexStatusChecks.evidence,
      checkedAt: indexStatusChecks.checkedAt,
    })
    .from(indexStatusChecks)
    .innerJoin(
      indexStatusPages,
      eq(indexStatusChecks.pageId, indexStatusPages.id),
    )
    .where(eq(indexStatusPages.projectId, projectId));
  return rows;
}

async function listSources(
  projectId: string,
): Promise<Array<{ url: string; source: IndexStatusSource }>> {
  return db
    .select({
      url: indexStatusPages.url,
      source: indexStatusPageSources.source,
    })
    .from(indexStatusPageSources)
    .innerJoin(
      indexStatusPages,
      eq(indexStatusPageSources.pageId, indexStatusPages.id),
    )
    .where(eq(indexStatusPages.projectId, projectId));
}

async function listPages(
  projectId: string,
  limit: number,
): Promise<Array<{ url: string; lastSeenAt: string }>> {
  return db
    .select({
      url: indexStatusPages.url,
      lastSeenAt: indexStatusPages.lastSeenAt,
    })
    .from(indexStatusPages)
    .where(eq(indexStatusPages.projectId, projectId))
    .orderBy(asc(indexStatusPages.url))
    .limit(limit);
}

/** When the collector last wrote anything (even nothing) — null when never. */
async function lastCollectedAt(
  projectId: string,
  collector: IndexStatusCollector,
): Promise<string | null> {
  const [row] = await db
    .select({ collectedAt: indexStatusRuns.collectedAt })
    .from(indexStatusRuns)
    .where(
      and(
        eq(indexStatusRuns.projectId, projectId),
        eq(indexStatusRuns.collector, collector),
      ),
    )
    .limit(1);
  return row?.collectedAt ?? null;
}

async function markCollected(
  projectId: string,
  collector: IndexStatusCollector,
  collectedAt: string,
): Promise<void> {
  await db
    .insert(indexStatusRuns)
    .values({ id: crypto.randomUUID(), projectId, collector, collectedAt })
    .onConflictDoUpdate({
      target: [indexStatusRuns.projectId, indexStatusRuns.collector],
      set: { collectedAt },
    });
}

export const IndexStatusRepository = {
  upsertPages,
  listPageIds,
  saveSources,
  saveChecks,
  listChecks,
  listSources,
  listPages,
  lastCollectedAt,
  markCollected,
};
