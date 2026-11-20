/* eslint-disable max-lines -- one file per repository under test; the SQL-backed due/trend/retry suites share the schema fixture and can't shrink below it */
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { rankTrackingConfigs } from "@/db/schema";
import type * as RankTrackingRepositoryModule from "./RankTrackingRepository";

// Real in-memory SQLite so the due-query ordering, the manual-interval filter,
// and claimDueConfig's compare-and-set run against actual SQL — the parts the
// mocked service tests can't see.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let testDb: ReturnType<typeof drizzle>;
let RankTrackingRepository: typeof RankTrackingRepositoryModule.RankTrackingRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  // Run batched writes one by one against the same in-memory database.
  vi.doMock("@/db/runBatch", () => ({
    DB_BATCH_SIZE: 100,
    executeInBatches: async <T>(
      items: T[],
      build: (tx: typeof testDb, item: T) => Promise<unknown>,
    ) => {
      for (const item of items) await build(testDb, item);
    },
  }));

  await client.executeMultiple(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT,
      location_code INTEGER NOT NULL DEFAULT 2840,
      language_code TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    );
    CREATE TABLE rank_tracking_configs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      location_code INTEGER NOT NULL DEFAULT 2840,
      language_code TEXT NOT NULL DEFAULT 'en',
      search_engine TEXT NOT NULL DEFAULT 'google',
      devices TEXT NOT NULL DEFAULT 'both',
      serp_depth INTEGER NOT NULL,
      schedule_interval TEXT NOT NULL DEFAULT 'weekly',
      location_name TEXT,
      auto_keyword_import INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT,
      next_check_at TEXT,
      last_skip_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rank_tracking_keywords (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      search_volume INTEGER,
      keyword_difficulty INTEGER,
      cpc REAL,
      pinned_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rank_check_runs (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      keywords_total INTEGER NOT NULL DEFAULT 0,
      is_subset_run INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL
    );
    CREATE TABLE rank_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      tracking_keyword_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      device TEXT NOT NULL,
      position INTEGER,
      url TEXT,
      serp_features TEXT,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX rank_snapshots_run_keyword_device_idx
      ON rank_snapshots (run_id, tracking_keyword_id, device);
  `);

  ({ RankTrackingRepository } = await import("./RankTrackingRepository"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM rank_snapshots;
    DELETE FROM rank_check_runs;
    DELETE FROM rank_tracking_keywords;
    DELETE FROM rank_tracking_configs;
    DELETE FROM projects;
  `);
});

const NOW = "2026-08-01T12:00:00.000Z";

async function seedProject(id: string, archivedAt: string | null = null) {
  await client.execute({
    sql: "INSERT INTO projects (id, organization_id, name, archived_at) VALUES (?, ?, ?, ?)",
    args: [id, `org_${id}`, id, archivedAt],
  });
}

async function seedConfig(input: {
  id: string;
  projectId?: string;
  domain?: string;
  nextCheckAt?: string | null;
  scheduleInterval?: string;
  isActive?: number;
  lastSkipReason?: string | null;
  searchEngine?: string;
}) {
  await client.execute({
    sql: `INSERT INTO rank_tracking_configs
      (id, project_id, domain, serp_depth, schedule_interval, is_active, next_check_at, last_skip_reason, search_engine)
      VALUES (?, ?, ?, 20, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.projectId ?? "proj_1",
      input.domain ?? `${input.id}.example.com`,
      input.scheduleInterval ?? "daily",
      input.isActive ?? 1,
      input.nextCheckAt === undefined
        ? "2026-07-01T05:00:00.000Z"
        : input.nextCheckAt,
      input.lastSkipReason ?? null,
      input.searchEngine ?? "google",
    ],
  });
}

async function getConfigRow(id: string) {
  const rows = await testDb
    .select({
      nextCheckAt: rankTrackingConfigs.nextCheckAt,
      lastSkipReason: rankTrackingConfigs.lastSkipReason,
    })
    .from(rankTrackingConfigs)
    .where(eq(rankTrackingConfigs.id, id));
  return rows[0];
}

describe("getDueConfigsWithOrganization", () => {
  it("returns due rows oldest-first and excludes manual, inactive, future, and archived rows", async () => {
    await seedProject("proj_1");
    await seedProject("proj_archived", "2026-07-15T00:00:00.000Z");
    await seedConfig({
      id: "cfg_newer",
      nextCheckAt: "2026-07-02T05:00:00.000Z",
    });
    await seedConfig({
      id: "cfg_oldest",
      nextCheckAt: "2026-07-01T05:00:00.000Z",
    });
    // Same timestamp as cfg_oldest — id breaks the tie deterministically.
    await seedConfig({
      id: "cfg_tie",
      nextCheckAt: "2026-07-01T05:00:00.000Z",
    });
    await seedConfig({ id: "cfg_manual", scheduleInterval: "manual" });
    await seedConfig({ id: "cfg_inactive", isActive: 0 });
    await seedConfig({
      id: "cfg_future",
      nextCheckAt: "2027-01-01T05:00:00.000Z",
    });
    await seedConfig({ id: "cfg_null_due", nextCheckAt: null });
    await seedConfig({ id: "cfg_archived", projectId: "proj_archived" });

    const due = await RankTrackingRepository.getDueConfigsWithOrganization(NOW);

    expect(due.map((c) => c.id)).toEqual([
      "cfg_oldest",
      "cfg_tie",
      "cfg_newer",
    ]);
    expect(due[0].organizationId).toBe("org_proj_1");
  });
});

describe("claimDueConfig", () => {
  it("advances the schedule and writes the skip reason when the token matches", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_1", nextCheckAt: "2026-07-01T05:00:00.000Z" });

    const claimed = await RankTrackingRepository.claimDueConfig({
      configId: "cfg_1",
      projectId: "proj_1",
      observedNextCheckAt: "2026-07-01T05:00:00.000Z",
      nextCheckAt: "2026-08-02T05:00:00.000Z",
      lastSkipReason: "plan_required",
    });

    expect(claimed).toBe(true);
    expect(await getConfigRow("cfg_1")).toEqual({
      nextCheckAt: "2026-08-02T05:00:00.000Z",
      lastSkipReason: "plan_required",
    });
  });

  it("refuses when the observed token no longer matches, leaving the row untouched", async () => {
    await seedProject("proj_1");
    await seedConfig({
      id: "cfg_1",
      nextCheckAt: "2026-07-20T05:00:00.000Z",
      lastSkipReason: "insufficient_credits",
    });

    const claimed = await RankTrackingRepository.claimDueConfig({
      configId: "cfg_1",
      projectId: "proj_1",
      observedNextCheckAt: "2026-07-01T05:00:00.000Z",
      nextCheckAt: "2026-08-02T05:00:00.000Z",
      lastSkipReason: null,
    });

    expect(claimed).toBe(false);
    expect(await getConfigRow("cfg_1")).toEqual({
      nextCheckAt: "2026-07-20T05:00:00.000Z",
      lastSkipReason: "insufficient_credits",
    });
  });

  it("refuses deactivated rows and preserves the skip reason when omitted", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_off", isActive: 0 });
    await seedConfig({
      id: "cfg_restore",
      nextCheckAt: "2026-08-02T05:00:00.000Z",
      lastSkipReason: "insufficient_credits",
    });

    expect(
      await RankTrackingRepository.claimDueConfig({
        configId: "cfg_off",
        projectId: "proj_1",
        observedNextCheckAt: "2026-07-01T05:00:00.000Z",
        nextCheckAt: "2026-08-02T05:00:00.000Z",
      }),
    ).toBe(false);

    // Restore-shaped claim: no lastSkipReason key — the existing value stays.
    expect(
      await RankTrackingRepository.claimDueConfig({
        configId: "cfg_restore",
        projectId: "proj_1",
        observedNextCheckAt: "2026-08-02T05:00:00.000Z",
        nextCheckAt: "2026-07-01T05:00:00.000Z",
      }),
    ).toBe(true);
    expect(await getConfigRow("cfg_restore")).toEqual({
      nextCheckAt: "2026-07-01T05:00:00.000Z",
      lastSkipReason: "insufficient_credits",
    });
  });
});

describe("getKeywordCountsForConfigs", () => {
  it("groups counts by config and omits configs with no keywords", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_a" });
    await seedConfig({ id: "cfg_b" });
    for (const [id, configId] of [
      ["kw1", "cfg_a"],
      ["kw2", "cfg_a"],
      ["kw3", "cfg_b"],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO rank_tracking_keywords (id, config_id, keyword) VALUES (?, ?, ?)",
        args: [id, configId, id],
      });
    }

    const counts = await RankTrackingRepository.getKeywordCountsForConfigs([
      "cfg_a",
      "cfg_b",
      "cfg_missing",
    ]);

    expect(counts).toEqual(
      new Map([
        ["cfg_a", 2],
        ["cfg_b", 1],
      ]),
    );
    expect(await RankTrackingRepository.getKeywordCountsForConfigs([])).toEqual(
      new Map(),
    );
  });
});

describe("setKeywordsPinned", () => {
  it("pins and unpins only keywords of the given config", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_a" });
    await seedConfig({ id: "cfg_b" });
    for (const [id, configId] of [
      ["kw1", "cfg_a"],
      ["kw2", "cfg_b"],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO rank_tracking_keywords (id, config_id, keyword) VALUES (?, ?, ?)",
        args: [id, configId, id],
      });
    }
    const pinnedIds = async () =>
      (
        await client.execute(
          "SELECT id FROM rank_tracking_keywords WHERE pinned_at IS NOT NULL",
        )
      ).rows.map((row) => row.id);

    // kw2 belongs to another config, so the config predicate skips it.
    expect(
      await RankTrackingRepository.setKeywordsPinned(
        ["kw1", "kw2"],
        "cfg_a",
        true,
      ),
    ).toEqual(["kw1"]);
    expect(await pinnedIds()).toEqual(["kw1"]);

    await RankTrackingRepository.setKeywordsPinned(["kw1"], "cfg_a", false);
    expect(await pinnedIds()).toEqual([]);
  });
});

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function seedKeyword(configId: string, keywordId: string) {
  await client.execute({
    sql: "INSERT INTO rank_tracking_keywords (id, config_id, keyword) VALUES (?, ?, ?)",
    args: [keywordId, configId, keywordId],
  });
}

/** Seed a completed run with its snapshots; checked_at mirrors started_at. */
async function seedTrendRun(input: {
  runId: string;
  configId: string;
  startedAt: string;
  status?: string;
  isSubsetRun?: boolean;
  keywordsTotal?: number;
  snapshots: Array<{
    keywordId: string;
    device?: "desktop" | "mobile";
    position: number | null;
    url?: string;
  }>;
}) {
  await client.execute({
    sql: `INSERT INTO rank_check_runs
      (id, config_id, project_id, status, keywords_total, is_subset_run, started_at)
      VALUES (?, ?, 'proj_1', ?, ?, ?, ?)`,
    args: [
      input.runId,
      input.configId,
      input.status ?? "completed",
      input.keywordsTotal ?? input.snapshots.length,
      input.isSubsetRun ? 1 : 0,
      input.startedAt,
    ],
  });
  for (const snapshot of input.snapshots) {
    await client.execute({
      sql: `INSERT INTO rank_snapshots
        (run_id, tracking_keyword_id, keyword, device, position, url, checked_at)
        VALUES (?, ?, 'kw', ?, ?, ?, ?)`,
      args: [
        input.runId,
        snapshot.keywordId,
        snapshot.device ?? "desktop",
        snapshot.position,
        snapshot.url ?? null,
        input.startedAt,
      ],
    });
  }
}

describe("getConfigTrend", () => {
  it("keeps every row of a run inside the range and drops a run that started before it", async () => {
    // run_b started before the 30-day cutoff, but one snapshot is after it.
    for (const [runId, startedAt, snapshotTimes] of [
      ["run_a", daysAgo(10), [daysAgo(10), daysAgo(10)]],
      ["run_b", daysAgo(30.01), [daysAgo(30.01), daysAgo(29.99)]],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO rank_check_runs (id, config_id, project_id, status, keywords_total, started_at) VALUES (?, 'cfg_a', 'proj_1', 'completed', 2, ?)",
        args: [runId, startedAt],
      });
      for (const [index, checkedAt] of snapshotTimes.entries()) {
        await client.execute({
          sql: "INSERT INTO rank_snapshots (run_id, tracking_keyword_id, keyword, device, position, checked_at) VALUES (?, ?, 'kw', 'desktop', 5, ?)",
          args: [runId, `kw${index}`, checkedAt],
        });
      }
    }

    const trend = await RankTrackingRepository.getConfigTrend(
      "cfg_a",
      "desktop",
      30,
    );

    expect(trend).toMatchObject([
      { runId: "run_a", keywordsTotal: 2, total: 2 },
    ]);
  });
});

async function seedRun(id: string, status: string) {
  await client.execute({
    sql: "INSERT INTO rank_check_runs (id, config_id, project_id, status, started_at) VALUES (?, 'cfg_a', 'proj_1', ?, ?)",
    args: [id, status, NOW],
  });
}

describe("getProjectTrend", () => {
  it("sums per-day buckets across configs and counts distinct ranking pages", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_g" });
    await seedConfig({ id: "cfg_y", searchEngine: "yandex" });

    await seedTrendRun({
      runId: "g1",
      configId: "cfg_g",
      startedAt: daysAgo(2),
      // Two snapshots but three tracked keywords: one check failed. The
      // per-day keywordsTotal must stay 3 — not multiplied by snapshots.
      keywordsTotal: 3,
      snapshots: [
        { keywordId: "g_kw1", position: 1, url: "https://s/a" },
        { keywordId: "g_kw2", position: 7, url: "https://s/b" },
      ],
    });
    await seedTrendRun({
      runId: "y1",
      configId: "cfg_y",
      startedAt: daysAgo(2),
      snapshots: [
        { keywordId: "y_kw1", position: 3, url: "https://s/c" },
        // A mobile row never leaks into the desktop trend.
        {
          keywordId: "y_kw1",
          device: "mobile",
          position: 2,
          url: "https://s/m",
        },
      ],
    });
    await seedTrendRun({
      runId: "g2",
      configId: "cfg_g",
      startedAt: daysAgo(1),
      snapshots: [{ keywordId: "g_kw1", position: 2, url: "https://s/a" }],
    });

    const trend = await RankTrackingRepository.getProjectTrend({
      projectId: "proj_1",
      device: "desktop",
      sinceDays: 30,
    });

    expect(trend).toHaveLength(2);
    const [dayOlder, dayNewer] = trend;
    expect(Number(dayOlder.total)).toBe(3);
    expect(Number(dayOlder.top1)).toBe(1);
    expect(Number(dayOlder.top2to5)).toBe(1);
    expect(Number(dayOlder.top6to10)).toBe(1);
    expect(Number(dayOlder.pages)).toBe(3);
    // g1's 3 tracked + y1's 2 tracked, not keywordsTotal × snapshot rows.
    expect(Number(dayOlder.keywordsTotal)).toBe(5);
    expect(Number(dayNewer.total)).toBe(1);
    expect(Number(dayNewer.top2to5)).toBe(1);
    expect(Number(dayNewer.pages)).toBe(1);
  });

  it("counts only the latest full run of a config per day", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_a" });
    const day = daysAgo(1).slice(0, 11);

    await seedTrendRun({
      runId: "early",
      configId: "cfg_a",
      startedAt: `${day}01:00:00`,
      snapshots: [{ keywordId: "kw1", position: 1, url: "https://s/a" }],
    });
    await seedTrendRun({
      runId: "late",
      configId: "cfg_a",
      startedAt: `${day}23:00:00`,
      snapshots: [{ keywordId: "kw1", position: 8, url: "https://s/a" }],
    });

    const trend = await RankTrackingRepository.getProjectTrend({
      projectId: "proj_1",
      device: "desktop",
      sinceDays: 30,
    });

    expect(trend).toHaveLength(1);
    expect(Number(trend[0].total)).toBe(1);
    expect(Number(trend[0].top1)).toBe(0);
    expect(Number(trend[0].top6to10)).toBe(1);
  });

  it("excludes subset and non-completed runs", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_a" });
    const day = daysAgo(1).slice(0, 11);

    await seedTrendRun({
      runId: "full",
      configId: "cfg_a",
      startedAt: `${day}01:00:00`,
      snapshots: [{ keywordId: "kw1", position: 5 }],
    });
    await seedTrendRun({
      runId: "subset",
      configId: "cfg_a",
      startedAt: `${day}02:00:00`,
      isSubsetRun: true,
      snapshots: [{ keywordId: "kw1", position: 1 }],
    });
    await seedTrendRun({
      runId: "running",
      configId: "cfg_a",
      startedAt: `${day}03:00:00`,
      status: "running",
      snapshots: [{ keywordId: "kw1", position: 1 }],
    });

    const trend = await RankTrackingRepository.getProjectTrend({
      projectId: "proj_1",
      device: "desktop",
      sinceDays: 30,
    });

    expect(trend).toHaveLength(1);
    expect(Number(trend[0].total)).toBe(1);
    expect(Number(trend[0].top2to5)).toBe(1);
  });

  it("filters by search engine", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_g" });
    await seedConfig({ id: "cfg_y", searchEngine: "yandex" });

    await seedTrendRun({
      runId: "g1",
      configId: "cfg_g",
      startedAt: daysAgo(1),
      snapshots: [{ keywordId: "g_kw1", position: 1 }],
    });
    await seedTrendRun({
      runId: "y1",
      configId: "cfg_y",
      startedAt: daysAgo(1),
      snapshots: [{ keywordId: "y_kw1", position: 9 }],
    });

    const trend = await RankTrackingRepository.getProjectTrend({
      projectId: "proj_1",
      device: "desktop",
      sinceDays: 30,
      searchEngine: "yandex",
    });

    expect(trend).toHaveLength(1);
    expect(Number(trend[0].total)).toBe(1);
    expect(Number(trend[0].top6to10)).toBe(1);
  });
});

describe("getProjectSummary", () => {
  it("buckets each keyword's latest snapshot and keeps stale keywords", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_a" });
    await seedKeyword("cfg_a", "kw1");
    await seedKeyword("cfg_a", "kw2");
    await seedKeyword("cfg_a", "kw_never_checked");

    await seedTrendRun({
      runId: "older",
      configId: "cfg_a",
      startedAt: daysAgo(2),
      snapshots: [
        { keywordId: "kw1", position: 1, url: "https://s/a" },
        { keywordId: "kw2", position: 3, url: "https://s/b" },
      ],
    });
    await seedTrendRun({
      runId: "newer",
      configId: "cfg_a",
      startedAt: daysAgo(1),
      snapshots: [
        // kw1 dropped from 1 to 8 — the latest snapshot wins, not any day's run.
        { keywordId: "kw1", position: 8, url: "https://s/a2" },
        // A mobile row never leaks into the desktop summary.
        { keywordId: "kw2", device: "mobile", position: 2, url: "https://s/m" },
      ],
    });

    const summary = await RankTrackingRepository.getProjectSummary({
      projectId: "proj_1",
      device: "desktop",
    });

    expect(Number(summary.total)).toBe(2); // kw1 + kw2; never-checked excluded
    expect(Number(summary.top1)).toBe(0);
    expect(Number(summary.top2to5)).toBe(1); // kw2's last known desktop position
    expect(Number(summary.top6to10)).toBe(1); // kw1's new position, not its old 1
    expect(Number(summary.pages)).toBe(2);
    expect(Number(summary.keywordsTotal)).toBe(3);
  });

  it("ignores archived trackers' keywords and snapshots", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_active" });
    await seedConfig({ id: "cfg_archived", isActive: 0 });
    await seedKeyword("cfg_active", "kw1");
    await seedKeyword("cfg_archived", "kw_gone");

    await seedTrendRun({
      runId: "r_active",
      configId: "cfg_active",
      startedAt: daysAgo(1),
      snapshots: [{ keywordId: "kw1", position: 1, url: "https://s/a" }],
    });
    await seedTrendRun({
      runId: "r_archived",
      configId: "cfg_archived",
      startedAt: daysAgo(1),
      snapshots: [{ keywordId: "kw_gone", position: 2, url: "https://s/g" }],
    });

    const summary = await RankTrackingRepository.getProjectSummary({
      projectId: "proj_1",
      device: "desktop",
    });

    expect(Number(summary.total)).toBe(1);
    expect(Number(summary.top1)).toBe(1);
    expect(Number(summary.keywordsTotal)).toBe(1);
  });

  it("ignores snapshots of keywords no longer tracked", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_a" });
    await seedKeyword("cfg_a", "kw_alive");
    await seedKeyword("cfg_a", "kw_removed");

    await seedTrendRun({
      runId: "ghost_run",
      configId: "cfg_a",
      startedAt: daysAgo(1),
      snapshots: [
        { keywordId: "kw_alive", position: 5, url: "https://s/a" },
        { keywordId: "kw_removed", position: 1, url: "https://s/ghost" },
      ],
    });
    // Pre-fix data shape: keyword row deleted, snapshot left behind.
    await client.execute(
      "DELETE FROM rank_tracking_keywords WHERE id = 'kw_removed'",
    );

    const summary = await RankTrackingRepository.getProjectSummary({
      projectId: "proj_1",
      device: "desktop",
    });

    expect(Number(summary.total)).toBe(1);
    expect(Number(summary.top1)).toBe(0); // the ghost's #1 must not count
    expect(Number(summary.top2to5)).toBe(1);
    expect(Number(summary.keywordsTotal)).toBe(1);
  });
});

describe("removeKeywordsFromConfig", () => {
  it("deletes the removed keywords' snapshots with them", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_a" });
    await seedKeyword("cfg_a", "kw1");
    await seedKeyword("cfg_a", "kw2");
    await seedTrendRun({
      runId: "r1",
      configId: "cfg_a",
      startedAt: daysAgo(1),
      snapshots: [
        { keywordId: "kw1", position: 1, url: "https://s/a" },
        { keywordId: "kw2", position: 2, url: "https://s/b" },
      ],
    });

    const removed = await RankTrackingRepository.removeKeywordsFromConfig(
      ["kw1"],
      "cfg_a",
    );

    expect(removed).toEqual(["kw1"]);
    const remaining = await client.execute(
      "SELECT tracking_keyword_id AS kw FROM rank_snapshots ORDER BY kw",
    );
    expect(remaining.rows.map((row) => row.kw)).toEqual(["kw2"]);
  });
});

// The domain overview's per-engine aggregates: one row per engine (per day for
// the trend) over the ACTIVE trackers whose domain is the project's own.
const DOMAIN_SCOPE = {
  projectId: "proj_1",
  domain: "mysite.com",
  device: "desktop" as const,
};

describe("getDomainEngineTrends", () => {
  it("buckets per engine and day, scoped to the domain's active trackers", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_g", domain: "mysite.com" });
    await seedConfig({
      id: "cfg_y",
      domain: "mysite.com",
      searchEngine: "yandex",
    });
    // Same project, other domain — and the project domain but archived: both
    // must stay out of every engine's rows.
    await seedConfig({ id: "cfg_other", domain: "other.com" });
    await seedConfig({ id: "cfg_off", domain: "mysite.com", isActive: 0 });

    await seedTrendRun({
      runId: "g_older",
      configId: "cfg_g",
      startedAt: daysAgo(2),
      keywordsTotal: 2,
      snapshots: [
        { keywordId: "g_kw1", position: 2, url: "https://s/a" },
        // A mobile row never leaks into the desktop trend.
        { keywordId: "g_kw1", device: "mobile", position: 1 },
      ],
    });
    await seedTrendRun({
      runId: "y_run",
      configId: "cfg_y",
      startedAt: daysAgo(1),
      keywordsTotal: 1,
      snapshots: [{ keywordId: "y_kw1", position: 12, url: "https://s/c" }],
    });
    await seedTrendRun({
      runId: "foreign",
      configId: "cfg_other",
      startedAt: daysAgo(1),
      snapshots: [{ keywordId: "o_kw1", position: 1 }],
    });

    const trend = await RankTrackingRepository.getDomainEngineTrends({
      ...DOMAIN_SCOPE,
      sinceDays: 30,
    });

    expect(trend).toHaveLength(2);
    const [googleDay, yandexDay] = trend;
    expect(googleDay).toMatchObject({
      searchEngine: "google",
      keywordsTotal: 2,
    });
    expect(Number(googleDay.total)).toBe(1); // desktop row only
    expect(Number(googleDay.top2to5)).toBe(1);
    expect(yandexDay).toMatchObject({
      searchEngine: "yandex",
      keywordsTotal: 1,
    });
    expect(Number(yandexDay.top11to50)).toBe(1);
  });
});

describe("getDomainEngineSummaries and getDomainEngineTopPages", () => {
  it("summarize each keyword's latest snapshot per engine and rank pages by query count", async () => {
    await seedProject("proj_1");
    await seedConfig({ id: "cfg_g", domain: "mysite.com" });
    await seedConfig({
      id: "cfg_y",
      domain: "mysite.com",
      searchEngine: "yandex",
    });
    for (const [id, configId] of [
      ["g_kw1", "cfg_g"],
      ["g_kw2", "cfg_g"],
      ["g_kw_gone", "cfg_g"],
      ["y_kw1", "cfg_y"],
    ] as const) {
      await seedKeyword(configId, id);
    }

    await seedTrendRun({
      runId: "g_older",
      configId: "cfg_g",
      startedAt: daysAgo(2),
      snapshots: [
        // g_kw1's stale position must lose to the newer run's.
        { keywordId: "g_kw1", position: 1, url: "https://s/a" },
      ],
    });
    await seedTrendRun({
      runId: "g_newer",
      configId: "cfg_g",
      startedAt: daysAgo(1),
      snapshots: [
        { keywordId: "g_kw1", position: 7, url: "https://s/a" },
        { keywordId: "g_kw2", position: 2, url: "https://s/a" },
        // Not found (null position) and unknown page (null url) drop out of
        // the top pages but still count as checked.
        { keywordId: "g_kw_gone", position: null },
      ],
    });
    await seedTrendRun({
      runId: "y_run",
      configId: "cfg_y",
      startedAt: daysAgo(1),
      snapshots: [{ keywordId: "y_kw1", position: 3, url: "https://s/c" }],
    });

    const { buckets, keywordsPerEngine } =
      await RankTrackingRepository.getDomainEngineSummaries(DOMAIN_SCOPE);

    const google = buckets.find((row) => row.searchEngine === "google");
    expect(Number(google?.total)).toBe(3);
    expect(Number(google?.top2to5)).toBe(1); // g_kw2
    expect(Number(google?.top6to10)).toBe(1); // g_kw1's latest, not its stale 1
    expect(Number(google?.pages)).toBe(1);
    expect(
      keywordsPerEngine.find((row) => row.searchEngine === "yandex")?.count,
    ).toBe(1);

    const topPages =
      await RankTrackingRepository.getDomainEngineTopPages(DOMAIN_SCOPE);

    expect(topPages).toEqual([
      {
        searchEngine: "google",
        url: "https://s/a",
        keywords: 2,
        bestPosition: 2,
      },
      {
        searchEngine: "yandex",
        url: "https://s/c",
        keywords: 1,
        bestPosition: 3,
      },
    ]);
  });
});

function snapshotRow(
  runId: string,
  trackingKeywordId: string,
  device: "desktop" | "mobile",
  position: number | null,
) {
  return { runId, trackingKeywordId, keyword: "kw", device, position };
}

describe("retry snapshot queries", () => {
  it("finds each keyword's best position on any device from completed runs only", async () => {
    await seedRun("run_done", "completed");
    await seedRun("run_active", "running");
    await RankTrackingRepository.insertSnapshots([
      snapshotRow("run_done", "kw_ranked", "desktop", null),
      snapshotRow("run_done", "kw_ranked", "mobile", 4),
      snapshotRow("run_done", "kw_never", "desktop", null),
      snapshotRow("run_active", "kw_never", "mobile", 1),
    ]);

    const best =
      await RankTrackingRepository.getBestPositionsForKeywords("cfg_a");

    expect(best).toEqual(
      expect.arrayContaining([
        { trackingKeywordId: "kw_never", position: null },
        { trackingKeywordId: "kw_ranked", position: 4 },
      ]),
    );
  });

  it("upserts a retry's result over the saved one, and keeps it through miss cleanup", async () => {
    await seedRun("run_a", "running");
    await RankTrackingRepository.insertSnapshots([
      snapshotRow("run_a", "kw_0", "desktop", null),
    ]);

    await RankTrackingRepository.upsertSnapshots([
      snapshotRow("run_a", "kw_0", "desktop", 2),
      snapshotRow("run_a", "kw_1", "desktop", 7),
    ]);

    // Cleanup of unconfirmed misses never removes a row that holds a position.
    await RankTrackingRepository.deleteNotFoundSnapshots([
      { runId: "run_a", trackingKeywordId: "kw_0", device: "desktop" },
    ]);

    const rows = await RankTrackingRepository.getSnapshotsForRun("run_a");
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trackingKeywordId: "kw_0", position: 2 }),
        expect.objectContaining({ trackingKeywordId: "kw_1", position: 7 }),
      ]),
    );
  });
});
