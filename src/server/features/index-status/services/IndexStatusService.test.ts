import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscTokenError } from "@/server/lib/gscErrors";
import { YandexWebmasterApiError } from "@/server/lib/yandexWebmasterErrors";
import { IndexStatusService } from "./IndexStatusService";

// The repository under the service runs against real SQLite (my migration);
// only the GSC/Yandex clients, the connection repositories, and the audit
// repository are module-mocked.
const state = vi.hoisted(() => {
  const gscMocks = {
    querySearchAnalytics: vi.fn<() => Promise<unknown[]>>(),
    inspectUrl: vi.fn<(siteUrl: string, url: string) => Promise<unknown>>(),
  };
  const yandexMocks = {
    getInSearchSamples:
      vi.fn<
        (
          hostId: string,
          input: { limit: number; offset: number },
        ) => Promise<unknown>
      >(),
    getSearchEventSamples:
      vi.fn<
        (
          hostId: string,
          input: { limit: number; offset: number },
        ) => Promise<unknown>
      >(),
  };
  return {
    database: null as DatabaseSync | null,
    gscConnection: null as { siteUrl: string } | null,
    yandexConnection: null as {
      projectId: string;
      hostId: string;
      hostUrl: string;
      connectedByUserId: string;
      yandexAccountId: string | null;
    } | null,
    auditPages: null as string[] | null,
    gscMocks,
    yandexMocks,
  };
});

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: drizzle(async (query, params, method) => {
    if (!state.database) throw new Error("Database not initialized");
    const statement = state.database.prepare(query);
    const values = params.map((value: unknown): SQLInputValue => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      )
        return value;
      throw new Error("Unexpected SQL parameter");
    });
    if (method === "run") {
      statement.run(...values);
      return { rows: [] };
    }
    return { rows: statement.all(...values).map((row) => Object.values(row)) };
  }),
}));
// The repository bulk-writes through executeInBatches; route its statements
// through the same mocked `@/db` proxy so they hit the real test SQLite.
vi.mock("@/db/runBatch", async () => {
  const { db } = await import("@/db");
  return {
    runBatch: async (
      build: (tx: unknown) => readonly Promise<unknown>[],
    ): Promise<void> => {
      for (const statement of build(db)) await statement;
    },
    executeInBatches: async <T>(
      items: T[],
      buildStatement: (tx: unknown, item: T) => Promise<unknown>,
    ): Promise<void> => {
      for (const item of items) await buildStatement(db, item);
    },
  };
});
vi.mock("@/server/lib/gscClient", () => ({
  createGscClient: () => state.gscMocks,
}));
vi.mock("@/server/lib/yandexWebmasterClient", () => ({
  createYandexWebmasterClient: () => state.yandexMocks,
}));
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: {
    getByProjectId: () => Promise.resolve(state.gscConnection),
  },
}));
vi.mock(
  "@/server/features/yandex/repositories/YandexConnectionRepository",
  () => ({
    YandexConnectionRepository: {
      getByProjectId: () => Promise.resolve(state.yandexConnection),
    },
  }),
);
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {
    getLatestAuditForProject: () =>
      Promise.resolve(state.auditPages === null ? null : { id: "a1" }),
    getPagesForAudit: () =>
      Promise.resolve((state.auditPages ?? []).map((url) => ({ url }))),
  },
}));

const IMPRESSION_ROWS = ["/indexed-by-impressions", "/inspected-pass"].map(
  (path) => ({
    keys: [`https://site.example${path}`],
    clicks: 1,
    impressions: 10,
    ctr: 0.1,
    position: 5,
  }),
);

const INSPECTIONS: Record<
  string,
  { verdict?: string; coverageState?: string }
> = {
  "https://site.example/inspected-pass": {
    verdict: "PASS",
    coverageState: "Submitted and indexed",
  },
  "https://site.example/inspected-blocked": {
    verdict: "NEGATIVE",
    coverageState: "Excluded by 'noindex' tag",
  },
};

const IN_SEARCH = [
  {
    url: "https://site.example/indexed-by-impressions/",
    lastAccess: "2026-11-01",
    title: "In search",
  },
  {
    url: "https://site.example/in-search-and-removed",
    lastAccess: "2026-11-01",
    title: null,
  },
];
const REMOVED_EVENT = (url: string) => ({
  url,
  event: "REMOVED_FROM_SEARCH" as const,
  excludedUrlStatus: "DUPLICATE",
  badHttpStatus: null,
  targetUrl: null,
  eventDate: "2026-11-10",
  lastAccess: "2026-11-10",
  title: null,
});
const EVENTS = [
  REMOVED_EVENT("https://site.example/removed-duplicate"),
  REMOVED_EVENT("https://site.example/in-search-and-removed"),
];

function connectBoth() {
  state.gscConnection = { siteUrl: "sc-domain:site.example" };
  state.yandexConnection = {
    projectId: "p1",
    hostId: "https:site.example:443",
    hostUrl: "https://site.example/",
    connectedByUserId: "u1",
    yandexAccountId: "ya-1",
  };
}

async function read(input: {
  problemsOnly?: boolean;
  pageSize?: number;
  force?: boolean;
}) {
  return IndexStatusService.getIndexStatus({
    projectId: "p1",
    problemsOnly: input.problemsOnly ?? false,
    page: 1,
    pageSize: input.pageSize ?? 100,
    force: input.force,
  });
}

function rowIndex(result: Awaited<ReturnType<typeof read>>) {
  return new Map(result.rows.map((row) => [row.url, row]));
}

beforeEach(() => {
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO projects VALUES ('p1');
  `);
  state.database.exec(
    readFileSync("drizzle/sqlite/0066_mighty_marvel_boy.sql", "utf8"),
  );
  state.gscConnection = null;
  state.yandexConnection = null;
  state.auditPages = null;
  state.gscMocks.querySearchAnalytics.mockResolvedValue(IMPRESSION_ROWS);
  state.gscMocks.inspectUrl.mockImplementation(async (_siteUrl, url) => ({
    indexStatusResult: INSPECTIONS[url] ?? null,
  }));
  state.yandexMocks.getInSearchSamples.mockResolvedValue({
    count: IN_SEARCH.length,
    samples: IN_SEARCH,
  });
  state.yandexMocks.getSearchEventSamples.mockResolvedValue({
    count: EVENTS.length,
    samples: EVENTS,
  });
});

describe("IndexStatusService.getIndexStatus", () => {
  it("collects once, then serves reads without further API calls", async () => {
    connectBoth();

    const first = await read({});
    expect(first.google.connected).toBe(true);
    expect(first.yandex.connected).toBe(true);
    expect(first.google.lastCollectedAt).not.toBeNull();
    expect(first.yandex.lastCollectedAt).not.toBeNull();
    expect(first.totals.pages).toBeGreaterThan(0);

    state.gscMocks.querySearchAnalytics.mockClear();
    state.gscMocks.inspectUrl.mockClear();
    state.yandexMocks.getInSearchSamples.mockClear();
    state.yandexMocks.getSearchEventSamples.mockClear();
    await read({});
    expect(state.gscMocks.querySearchAnalytics).not.toHaveBeenCalled();
    expect(state.gscMocks.inspectUrl).not.toHaveBeenCalled();
    expect(state.yandexMocks.getInSearchSamples).not.toHaveBeenCalled();
    expect(state.yandexMocks.getSearchEventSamples).not.toHaveBeenCalled();
  });

  it("maps inspections, impressions, and Yandex samples into verdicts", async () => {
    connectBoth();
    // A second inspected page that reaches Google via impressions too.
    state.gscMocks.querySearchAnalytics.mockResolvedValue([
      IMPRESSION_ROWS[0],
      {
        keys: ["https://site.example/inspected-blocked"],
        clicks: 0,
        impressions: 3,
        ctr: 0,
        position: 8,
      },
    ]);

    const rows = rowIndex(await read({}));
    expect(
      rows.get("https://site.example/indexed-by-impressions")?.google,
    ).toMatchObject({ status: "likely_indexed", evidence: "gsc_impressions" });
    expect(
      rows.get("https://site.example/inspected-blocked")?.google,
    ).toMatchObject({
      status: "not_indexed",
      reason: "Excluded by 'noindex' tag",
      evidence: "url_inspection",
    });
    expect(
      rows.get("https://site.example/removed-duplicate")?.yandex,
    ).toMatchObject({
      status: "not_indexed",
      reason: "Duplicates a page already in search",
    });
    // Trailing slash normalized: the Yandex sample and the GSC impressions row
    // are the same page, and in-search beats the removal event.
    expect(
      rows.get("https://site.example/in-search-and-removed")?.yandex,
    ).toMatchObject({ status: "indexed", evidence: "yandex_in_search" });
  });

  it("keeps a stored inspection over a newer impressions heuristic", async () => {
    connectBoth();
    await read({});
    // Age everything out so the next read re-collects.
    state.database!.exec(
      "UPDATE index_status_runs SET collected_at = '2000-01-01T00:00:00.000Z'",
    );
    state.gscMocks.inspectUrl.mockClear();

    const rows = rowIndex(await read({}));
    // Still inspected (fresh TTL) and not re-inspected, nor downgraded to the
    // impressions heuristic even though the page still has impressions.
    expect(
      rows.get("https://site.example/inspected-pass")?.google,
    ).toMatchObject({
      status: "indexed",
      evidence: "url_inspection",
    });
    const inspectedUrls = state.gscMocks.inspectUrl.mock.calls.map(
      ([, url]) => url,
    );
    expect(inspectedUrls).not.toContain("https://site.example/inspected-pass");
  });

  it("caps inspections per collect", async () => {
    connectBoth();
    state.gscMocks.querySearchAnalytics.mockResolvedValue(
      Array.from({ length: 80 }, (_, i) => ({
        keys: [`https://site.example/many-${i}`],
        clicks: 0,
        impressions: 1,
        ctr: 0,
        position: 1,
      })),
    );
    state.gscMocks.inspectUrl.mockResolvedValue({
      indexStatusResult: { verdict: "PASS", coverageState: "Indexed" },
    });

    const result = await read({});
    expect(result.totals.inspected).toBe(50);
    expect(state.gscMocks.inspectUrl).toHaveBeenCalledTimes(50);
  });

  it("reports a dead grant as unavailable and a server error as collectError", async () => {
    connectBoth();
    await read({});
    state.database!.exec(
      "UPDATE index_status_runs SET collected_at = '2000-01-01T00:00:00.000Z'",
    );
    state.gscMocks.querySearchAnalytics.mockRejectedValue(
      new GscTokenError("Could not mint a Search Console access token"),
    );
    state.yandexMocks.getInSearchSamples.mockRejectedValue(
      new YandexWebmasterApiError(500, "Yandex Webmaster API error (500)."),
    );

    const result = await read({});
    expect(result.google.unavailableReason).toBe(
      "Could not mint a Search Console access token",
    );
    expect(result.google.collectError).toBeNull();
    expect(result.yandex.unavailableReason).toBeNull();
    expect(result.yandex.collectError).toBe(
      "Yandex Webmaster API error (500).",
    );
    // Stored verdicts survive both failures — one dead engine never blanks
    // the other's column.
    expect(result.totals.pages).toBeGreaterThan(0);
    expect(result.totals.inspected).toBeGreaterThan(0);
    expect(
      rowIndex(result).get("https://site.example/inspected-pass")?.google,
    ).not.toBeNull();
  });

  it("filters to pages missing from at least one index", async () => {
    connectBoth();
    const all = await read({});
    expect(all.totalMatching).toBe(all.totals.pages);
    expect(all.totals.problems).toBeGreaterThan(0);

    const problems = await read({ problemsOnly: true });
    expect(problems.totalMatching).toBe(all.totals.problems);
    for (const row of problems.rows) {
      expect(
        row.google?.status === "not_indexed" ||
          row.yandex?.status === "not_indexed",
      ).toBe(true);
    }
  });

  it("adds audited pages to the universe with honest no-data columns", async () => {
    connectBoth();
    state.auditPages = ["https://site.example/audit-only"];

    const auditRow = rowIndex(await read({})).get(
      "https://site.example/audit-only",
    );
    expect(auditRow).toBeDefined();
    expect(auditRow?.sources).toContain("audit_crawl");
    expect(auditRow?.google).toBeNull();
    expect(auditRow?.yandex).toBeNull();
  });
});
