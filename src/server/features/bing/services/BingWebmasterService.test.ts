import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BingWebmasterApiError } from "@/server/lib/bingWebmasterErrors";
import { WebmasterBacklinksRepository } from "@/server/features/backlinks/repositories/WebmasterBacklinksRepository";
import { BingWebmasterService } from "./BingWebmasterService";
import { BingConnectionRepository } from "../repositories/BingConnectionRepository";

// The repositories under the service run against real SQLite; only the Bing
// client and the secret crypto are module-mocked.
const state = vi.hoisted(() => {
  type StatsRow = {
    date: string;
    query: string;
    impressions: number | null;
    clicks: number | null;
    avgImpressionPosition: number | null;
    avgClickPosition: number | null;
  };
  const clientMocks = {
    getUserSites: vi.fn<
      () => Promise<Array<{ siteUrl: string; verified: boolean }>>
    >(),
    getQueryStats: vi.fn<
      () => Promise<{
        rows: StatsRow[];
        reportedDateFrom: string | null;
        reportedDateTo: string | null;
      }>
    >(),
    getLinkCounts: vi.fn<
      (
        siteUrl: string,
        page: number,
      ) => Promise<{ links: Array<{ url: string; count: number }>; totalPages: number | null }>
    >(),
    getUrlLinks: vi.fn<
      (
        siteUrl: string,
        link: string,
        page: number,
      ) => Promise<{
        details: Array<{ sourceUrl: string; anchorText: string | null }>;
        totalPages: number | null;
      }>
    >(),
  };
  return {
    database: null as DatabaseSync | null,
    ...clientMocks,
    clientMocks,
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
vi.mock("@/server/lib/bingWebmasterClient", () => ({
  createBingWebmasterClient: () => state.clientMocks,
}));
vi.mock("@/server/lib/secretCrypto", () => ({
  // Keys round-trip with a marker; a value that lost it cannot be decrypted,
  // which is how the undecryptable-key case is exercised.
  getSecretCrypto: () =>
    Promise.resolve({
      encrypt: (value: string) => Promise.resolve(`enc:${value}`),
      decrypt: (value: string) =>
        value.startsWith("enc:")
          ? Promise.resolve(value.slice("enc:".length))
          : Promise.reject(new Error("unrecognized ciphertext")),
    }),
}));

const SITE_P1 = "http://p1.example/";
const SITE_P2 = "http://p2.example/";
const P1_LINK_COUNTS = [{ url: "https://p1.example/a", count: 14 }];
const P1_DETAILS = [
  { sourceUrl: "https://other.example/page", anchorText: "read more" },
  { sourceUrl: "https://second.example/", anchorText: null },
];
const P2_LINK_COUNTS = [{ url: "https://p2.example/b", count: 5 }];
const P2_DETAILS = [{ sourceUrl: "https://p2source.example/", anchorText: "p2" }];

// Weekly buckets Bing would return for site P1: two inside the requested
// window, one in the previous window, one from long ago.
const STATS_ROWS = [
  {
    date: "2026-03-07",
    query: "alpha",
    impressions: 100,
    clicks: 10,
    avgImpressionPosition: 2,
    avgClickPosition: 3,
  },
  {
    date: "2026-03-14",
    query: "alpha",
    impressions: 40,
    clicks: 2,
    avgImpressionPosition: 4,
    avgClickPosition: 5,
  },
  {
    date: "2026-03-14",
    query: "beta",
    impressions: 10,
    clicks: 0,
    avgImpressionPosition: 9,
    avgClickPosition: null,
  },
  {
    date: "2026-02-14",
    query: "alpha",
    impressions: 50,
    clicks: 5,
    avgImpressionPosition: 3,
    avgClickPosition: 4,
  },
  {
    date: "2025-01-03",
    query: "old",
    impressions: 5,
    clicks: 0,
    avgImpressionPosition: 1,
    avgClickPosition: 1,
  },
];

function connect(projectId: string, siteUrl: string = SITE_P1) {
  return BingConnectionRepository.upsert({
    projectId,
    organizationId: "org1",
    siteUrl,
    apiKey: "enc:bing_key",
    connectedByUserId: "u1",
  });
}

beforeEach(() => {
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('org1');
    INSERT INTO projects VALUES ('p1'), ('p2');
  `);
  state.database.exec(
    readFileSync("drizzle/sqlite/0065_lethal_miss_america.sql", "utf8"),
  );
  state.database.exec(
    readFileSync("drizzle/sqlite/0067_wakeful_eddie_brock.sql", "utf8"),
  );
  state.getUserSites.mockResolvedValue([
    { siteUrl: SITE_P1, verified: true },
    { siteUrl: SITE_P2, verified: true },
  ]);
  state.getQueryStats.mockResolvedValue({
    rows: STATS_ROWS,
    reportedDateFrom: "2025-01-03",
    reportedDateTo: "2026-03-14",
  });
  state.getLinkCounts.mockImplementation(async (siteUrl, page) => {
    if (page > 0) return { links: [], totalPages: 1 };
    return siteUrl === SITE_P1
      ? { links: P1_LINK_COUNTS, totalPages: 1 }
      : { links: P2_LINK_COUNTS, totalPages: 1 };
  });
  state.getUrlLinks.mockImplementation(async (siteUrl) =>
    siteUrl === SITE_P1
      ? { details: P1_DETAILS, totalPages: 1 }
      : { details: P2_DETAILS, totalPages: 1 },
  );
});

describe("BingWebmasterService.getSearchPerformance", () => {
  it("rolls weekly buckets up per query, windowed and ordered by the requested metric", async () => {
    await connect("p1");
    const result = await BingWebmasterService.getSearchPerformance({
      projectId: "p1",
      startDate: "2026-03-01",
      endDate: "2026-03-20",
      orderBy: "impressions",
    });

    expect(result.rows.map((row) => row.query)).toEqual(["alpha", "beta"]);
    expect(result.rows[0]).toEqual({
      query: "alpha",
      impressions: 140,
      clicks: 12,
      // Impression-weighted mean of the two buckets: (2×100 + 4×40) / 140.
      avgImpressionPosition: (2 * 100 + 4 * 40) / 140,
      avgClickPosition: (3 * 100 + 5 * 40) / 140,
    });
    expect(result.totals).toMatchObject({ impressions: 150, clicks: 12 });
    expect(result.dateFrom).toBe("2026-03-01");
    expect(result.dateTo).toBe("2026-03-20");
    // Bing reported all of history; the payload names it so the UI can say the
    // loaded window is the filter, not Bing's data range.
    expect(result.reportedDateFrom).toBe("2025-01-03");
    expect(result.reportedDateTo).toBe("2026-03-14");
    expect(state.getQueryStats).toHaveBeenCalledTimes(1);
  });

  it("compares the previous same-length window over the same queries from the one response", async () => {
    await connect("p1");
    const { change } = await BingWebmasterService.getSearchPerformance({
      projectId: "p1",
      startDate: "2026-03-01",
      endDate: "2026-03-20",
    });

    // GetQueryStats has no date parameters, so the comparison is computed from
    // the buckets already fetched — alpha's 2026-02-14 bucket; beta was not in
    // that week's top, so it contributes nothing.
    expect(change).toEqual({
      dateFrom: "2026-02-09",
      dateTo: "2026-02-28",
      matchedQueryCount: 1,
      totals: { impressions: 50, clicks: 5, ctr: 0.1, position: 3 },
    });
    expect(state.getQueryStats).toHaveBeenCalledTimes(1);
  });

  it("throws the not-connected error for a project without a Bing connection", async () => {
    await expect(
      BingWebmasterService.getSearchPerformance({ projectId: "p1" }),
    ).rejects.toThrow("Bing Webmaster is not connected for this project");
    expect(state.getQueryStats).not.toHaveBeenCalled();
  });
});

describe("BingWebmasterService.setSite", () => {
  it("stores the key encrypted and only a verified site the key can see", async () => {
    await BingWebmasterService.setSite({
      projectId: "p1",
      organizationId: "org1",
      apiKey: "bing_key",
      siteUrl: SITE_P1,
      userId: "u1",
    });
    expect(await BingConnectionRepository.getByProjectId("p1")).toMatchObject({
      apiKey: "enc:bing_key",
      siteUrl: SITE_P1,
    });

    await expect(
      BingWebmasterService.setSite({
        projectId: "p1",
        organizationId: "org1",
        apiKey: "bing_key",
        siteUrl: "http://unknown.example/",
        userId: "u1",
      }),
    ).rejects.toThrow("isn't available");
  });
});

describe("BingWebmasterService.getLinks", () => {
  it("collects samples on the first read, then serves stored samples within the TTL without re-collecting", async () => {
    await connect("p1");
    const first = await BingWebmasterService.getLinks({ projectId: "p1" });
    expect(first).toMatchObject({
      connected: true,
      siteUrl: SITE_P1,
      linkCounts: P1_LINK_COUNTS,
      loadedLinksTotal: 14,
      totalPages: 1,
      linkCountsTruncated: false,
      storedSamplesCount: 2,
      collectError: null,
    });
    expect(first.samples).toEqual([
      {
        sourceUrl: "https://other.example/page",
        destinationUrl: "https://p1.example/a",
        anchorText: "read more",
      },
      {
        sourceUrl: "https://second.example/",
        destinationUrl: "https://p1.example/a",
        anchorText: null,
      },
    ]);
    // The snapshot row is what the TTL keys on, written under the Bing source.
    expect(
      state.database!
        .prepare(
          "SELECT links_total_count, source FROM webmaster_backlink_snapshots",
        )
        .all(),
    ).toEqual([{ links_total_count: 14, source: "bing_webmaster" }]);

    const capturedAt = state.database!
      .prepare("SELECT captured_at FROM webmaster_backlink_snapshots")
      .get() as { captured_at: string };
    state.getUrlLinks.mockClear();

    const second = await BingWebmasterService.getLinks({ projectId: "p1" });
    // Anchor text is not persisted, so a stored read renders without it.
    // Stored rows have no discovery date, so their order is not guaranteed.
    expect(
      [...second.samples].sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl)),
    ).toEqual([
      { sourceUrl: "https://other.example/page", destinationUrl: "https://p1.example/a", anchorText: null },
      { sourceUrl: "https://second.example/", destinationUrl: "https://p1.example/a", anchorText: null },
    ]);
    // Per-page counts are read live on every visit (the shared tables have no
    // per-URL home for them); only the persisted half is TTL-gated.
    expect(second.linkCounts).toEqual(P1_LINK_COUNTS);
    expect(state.getUrlLinks).not.toHaveBeenCalled();
    // A read never moves the staleness marker.
    expect(
      state.database!
        .prepare("SELECT captured_at FROM webmaster_backlink_snapshots")
        .get(),
    ).toEqual(capturedAt);
  });

  it("keeps two projects' link data separate", async () => {
    await connect("p1");
    await connect("p2", SITE_P2);
    await BingWebmasterService.getLinks({ projectId: "p1" });
    await BingWebmasterService.getLinks({ projectId: "p2" });

    // Each project stored only its own site's samples.
    expect(
      await WebmasterBacklinksRepository.countSamples("p1", "bing_webmaster"),
    ).toBe(2);
    expect(
      await WebmasterBacklinksRepository.countSamples("p2", "bing_webmaster"),
    ).toBe(1);
    const p1Samples = await WebmasterBacklinksRepository.listSamples(
      "p1",
      "bing_webmaster",
      100,
    );
    expect(
      p1Samples.map((sample) => sample.sourceUrl).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["https://other.example/page", "https://second.example/"]);
  });

  it("re-collects when the stored snapshot is older than the TTL", async () => {
    await connect("p1");
    await BingWebmasterService.getLinks({ projectId: "p1" });
    state.database!.exec(
      "UPDATE webmaster_backlink_snapshots SET captured_at = '2000-01-01T00:00:00.000Z'",
    );
    state.getUrlLinks.mockClear();

    await BingWebmasterService.getLinks({ projectId: "p1" });
    expect(state.getUrlLinks).toHaveBeenCalled();
    expect(
      await WebmasterBacklinksRepository.countSamples("p1", "bing_webmaster"),
    ).toBe(2);
  });

  it("degrades to disconnected with a reason when Bing rejects the key, hiding stored data", async () => {
    await connect("p1");
    await BingWebmasterService.getLinks({ projectId: "p1" });
    state.database!.exec(
      "UPDATE webmaster_backlink_snapshots SET captured_at = '2000-01-01T00:00:00.000Z'",
    );
    state.getLinkCounts.mockRejectedValue(
      new BingWebmasterApiError(
        400,
        "Bing Webmaster API error (400): InvalidApiKey",
        3,
      ),
    );

    const result = await BingWebmasterService.getLinks({ projectId: "p1" });
    expect(result).toMatchObject({
      connected: false,
      unavailableReason: "Bing Webmaster API error (400): InvalidApiKey",
      linkCounts: [],
      samples: [],
    });
  });

  it("keeps stored samples with a collectError on an unexpected failure", async () => {
    await connect("p1");
    await BingWebmasterService.getLinks({ projectId: "p1" });
    state.database!.exec(
      "UPDATE webmaster_backlink_snapshots SET captured_at = '2000-01-01T00:00:00.000Z'",
    );
    state.getLinkCounts.mockRejectedValue(
      new BingWebmasterApiError(500, "Bing Webmaster API error (500).", 9),
    );

    const result = await BingWebmasterService.getLinks({ projectId: "p1" });
    expect(result.connected).toBe(true);
    expect(result.collectError).toBe("Bing Webmaster API error (500).");
    expect(result.samples).toHaveLength(2);
    expect(result.linkCounts).toEqual([]);
  });

  it("reports an undecryptable stored key as an auth failure, not a fault", async () => {
    await connect("p1");
    state.database!.exec("UPDATE bing_connections SET api_key = 'not-a-secret'");
    const result = await BingWebmasterService.getLinks({ projectId: "p1" });
    expect(result).toMatchObject({
      connected: false,
      unavailableReason:
        "Could not decrypt the stored Bing Webmaster API key. Reconnect Bing Webmaster.",
    });
  });
});

describe("BingWebmasterService.disconnect", () => {
  it("drops the connection so reads report not connected", async () => {
    await connect("p1");
    await BingWebmasterService.disconnect({ projectId: "p1" });
    expect(await BingConnectionRepository.getByProjectId("p1")).toBeNull();
    await expect(
      BingWebmasterService.getSearchPerformance({ projectId: "p1" }),
    ).rejects.toThrow("Bing Webmaster is not connected for this project");
  });
});
