import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { isExpectedGrantFailure as isGscGrantFailure } from "@/server/features/gsc/services/GscService";
import { YandexConnectionRepository } from "@/server/features/yandex/repositories/YandexConnectionRepository";
import { isExpectedGrantFailure as isYandexGrantFailure } from "@/server/features/yandex/services/YandexWebmasterService";
import {
  collectAuditPages,
  collectGoogle,
  collectYandex,
  type EngineState,
} from "./indexStatusCollectors";
import {
  IndexStatusRepository,
  type IndexStatusCollector,
  type IndexStatusSource,
} from "../repositories/IndexStatusRepository";

// Collects re-run per source at most twice a day; reads in between are served
// from storage.
const COLLECT_TTL_MS = 12 * 60 * 60 * 1000;
// ponytail: the read path loads the whole project universe (collects cap it at
// ~5k pages) and paginates in memory; SQL-side pagination if universes grow.
const READ_UNIVERSE_LIMIT = 5000;

type IndexStatusCheck = {
  status: "indexed" | "not_indexed" | "likely_indexed";
  reason: string | null;
  evidence:
    | "url_inspection"
    | "gsc_impressions"
    | "gsc_no_impressions"
    | "yandex_in_search"
    | "yandex_event";
  checkedAt: string;
};

type IndexStatusRow = {
  url: string;
  sources: IndexStatusSource[];
  google: IndexStatusCheck | null;
  yandex: IndexStatusCheck | null;
};

type IndexStatusResult = {
  google: {
    connected: boolean;
    siteUrl: string | null;
    unavailableReason: string | null;
    collectError: string | null;
    lastCollectedAt: string | null;
    inspectedCount: number;
  };
  yandex: {
    connected: boolean;
    hostUrl: string | null;
    unavailableReason: string | null;
    collectError: string | null;
    lastCollectedAt: string | null;
  };
  totals: { pages: number; problems: number; inspected: number };
  rows: IndexStatusRow[];
  totalMatching: number;
  page: number;
  pageSize: number;
};

function isStale(collectedAt: string | null): boolean {
  return (
    collectedAt === null ||
    Date.now() - Date.parse(collectedAt) > COLLECT_TTL_MS
  );
}

/** Run one collector unless its data is fresh. Expected grant failures and
 *  unexpected errors are captured per collector, never thrown — one dead
 *  engine must not blank the other's column. Grant failures leave the
 *  collector stale so reads keep retrying cheaply until the reconnect. */
async function ensureCollected(input: {
  projectId: string;
  force: boolean;
}): Promise<{ google: EngineState; yandex: EngineState }> {
  const [gscConnection, yandexConnection] = await Promise.all([
    GscConnectionRepository.getByProjectId(input.projectId),
    YandexConnectionRepository.getByProjectId(input.projectId),
  ]);
  const google: EngineState = { unavailableReason: null, collectError: null };
  const yandex: EngineState = { unavailableReason: null, collectError: null };
  const now = new Date().toISOString();

  const stale = async (collector: IndexStatusCollector) =>
    input.force ||
    isStale(
      await IndexStatusRepository.lastCollectedAt(input.projectId, collector),
    );

  if (await stale("audit")) {
    try {
      const added = await collectAuditPages({
        projectId: input.projectId,
        now,
      });
      if (added)
        await IndexStatusRepository.markCollected(
          input.projectId,
          "audit",
          now,
        );
    } catch (error) {
      console.error("index_status_audit_collect_failed", {
        projectId: input.projectId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (gscConnection && (await stale("google"))) {
    try {
      const state = await collectGoogle({
        projectId: input.projectId,
        connection: gscConnection,
        now,
      });
      google.collectError = state.collectError;
      await IndexStatusRepository.markCollected(input.projectId, "google", now);
    } catch (error) {
      captureEngineError(google, error, isGscGrantFailure);
      if (google.collectError) {
        console.error("index_status_google_collect_failed", {
          projectId: input.projectId,
          reason: google.collectError,
        });
        await IndexStatusRepository.markCollected(
          input.projectId,
          "google",
          now,
        );
      }
    }
  }

  if (yandexConnection && (await stale("yandex"))) {
    try {
      await collectYandex({
        projectId: input.projectId,
        hostId: yandexConnection.hostId,
        connectedByUserId: yandexConnection.connectedByUserId,
        yandexAccountId: yandexConnection.yandexAccountId,
        now,
      });
      await IndexStatusRepository.markCollected(input.projectId, "yandex", now);
    } catch (error) {
      captureEngineError(yandex, error, isYandexGrantFailure);
      if (yandex.collectError) {
        console.error("index_status_yandex_collect_failed", {
          projectId: input.projectId,
          reason: yandex.collectError,
        });
        await IndexStatusRepository.markCollected(
          input.projectId,
          "yandex",
          now,
        );
      }
    }
  }

  return { google, yandex };
}

/** Split a collect failure into dead-grant (unavailableReason) vs everything
 *  else (collectError). */
function captureEngineError(
  state: EngineState,
  error: unknown,
  isGrantFailure: (error: unknown) => boolean,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isGrantFailure(error)) state.unavailableReason = message;
  else state.collectError = message;
}

function isProblem(row: IndexStatusRow): boolean {
  return (
    row.google?.status === "not_indexed" || row.yandex?.status === "not_indexed"
  );
}

/** The Index Status page payload. Collects from connected engines when their
 *  data is stale (or `force`), then serves stored pages — a render never burns
 *  the GSC inspection quota. */
async function getIndexStatus(input: {
  projectId: string;
  problemsOnly: boolean;
  page: number;
  pageSize: number;
  force?: boolean;
}): Promise<IndexStatusResult> {
  const [gscConnection, yandexConnection, collected] = await Promise.all([
    GscConnectionRepository.getByProjectId(input.projectId),
    YandexConnectionRepository.getByProjectId(input.projectId),
    ensureCollected({
      projectId: input.projectId,
      force: input.force ?? false,
    }),
  ]);

  const [pages, checks, sources, googleCollectedAt, yandexCollectedAt] =
    await Promise.all([
      IndexStatusRepository.listPages(input.projectId, READ_UNIVERSE_LIMIT),
      IndexStatusRepository.listChecks(input.projectId),
      IndexStatusRepository.listSources(input.projectId),
      IndexStatusRepository.lastCollectedAt(input.projectId, "google"),
      IndexStatusRepository.lastCollectedAt(input.projectId, "yandex"),
    ]);

  const sourcesByUrl = new Map<string, IndexStatusSource[]>();
  for (const row of sources) {
    const list = sourcesByUrl.get(row.url) ?? [];
    list.push(row.source);
    sourcesByUrl.set(row.url, list);
  }
  const checkByUrl = new Map(
    checks.map((check) => [`${check.engine}:${check.url}`, check]),
  );
  const pick = (
    engine: "google" | "yandex",
    url: string,
  ): IndexStatusCheck | null => {
    const check = checkByUrl.get(`${engine}:${url}`);
    return check === undefined
      ? null
      : {
          status: check.status,
          reason: check.reason,
          evidence: check.evidence,
          checkedAt: check.checkedAt,
        };
  };

  const all: IndexStatusRow[] = pages.map((page) => ({
    url: page.url,
    sources: sourcesByUrl.get(page.url) ?? [],
    google: pick("google", page.url),
    yandex: pick("yandex", page.url),
  }));
  const inspected = all.filter(
    (row) => row.google?.evidence === "url_inspection",
  ).length;
  const filtered = input.problemsOnly ? all.filter(isProblem) : all;
  const start = (input.page - 1) * input.pageSize;

  return {
    google: {
      connected: Boolean(gscConnection),
      siteUrl: gscConnection?.siteUrl ?? null,
      unavailableReason: collected.google.unavailableReason,
      collectError: collected.google.collectError,
      lastCollectedAt: googleCollectedAt,
      inspectedCount: inspected,
    },
    yandex: {
      connected: Boolean(yandexConnection),
      hostUrl: yandexConnection?.hostUrl ?? null,
      unavailableReason: collected.yandex.unavailableReason,
      collectError: collected.yandex.collectError,
      lastCollectedAt: yandexCollectedAt,
    },
    totals: {
      pages: all.length,
      problems: all.filter(isProblem).length,
      inspected,
    },
    rows: filtered.slice(start, start + input.pageSize),
    totalMatching: filtered.length,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export const IndexStatusService = {
  getIndexStatus,
};
