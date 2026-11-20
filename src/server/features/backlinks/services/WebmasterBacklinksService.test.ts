import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  YandexWebmasterApiError,
  YandexWebmasterTokenError,
} from "@/server/lib/yandexWebmasterErrors";
import { WebmasterBacklinksService } from "./WebmasterBacklinksService";

// The repository under the service runs against real SQLite; only the Yandex
// client and the connection repositories are module-mocked.
const state = vi.hoisted(() => {
  type HistoryPoint = { date: string; linksTotalCount: number | null };
  type SampleLink = {
    sourceUrl: string;
    destinationUrl: string;
    discoveryDate: string | null;
    sourceLastAccessDate: string | null;
  };
  const clientMocks = {
    getExternalLinksHistory: vi.fn<() => Promise<HistoryPoint[]>>(),
    getExternalLinksSamples:
      vi.fn<
        (
          hostId: string,
          input: { limit: number; offset: number },
        ) => Promise<{ count: number; links: SampleLink[] }>
      >(),
  };
  return {
    database: null as DatabaseSync | null,
    yandexConnection: null as {
      projectId: string;
      hostId: string;
      hostUrl: string;
      connectedByUserId: string;
      yandexAccountId: string | null;
    } | null,
    gscConnection: null as { siteUrl: string } | null,
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
vi.mock("@/server/lib/yandexWebmasterClient", () => ({
  createYandexWebmasterClient: () => state.clientMocks,
}));
vi.mock(
  "@/server/features/yandex/repositories/YandexConnectionRepository",
  () => ({
    YandexConnectionRepository: {
      getByProjectId: (projectId: string) =>
        state.yandexConnection?.projectId === projectId
          ? Promise.resolve(state.yandexConnection)
          : Promise.resolve(null),
    },
  }),
);
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: {
    getByProjectId: () => Promise.resolve(state.gscConnection),
  },
}));

const HISTORY = [
  { date: "2026-01-01", linksTotalCount: 40 },
  { date: "2026-02-01", linksTotalCount: 55 },
];
const SAMPLE_LINKS = [
  {
    sourceUrl: "https://a.example/page/",
    destinationUrl: "https://site.example/x",
    discoveryDate: "2026-01-05",
    sourceLastAccessDate: "2026-01-06",
  },
  {
    sourceUrl: "https://b.example/",
    destinationUrl: "https://site.example/y",
    discoveryDate: null,
    sourceLastAccessDate: null,
  },
];

function connectYandex() {
  state.yandexConnection = {
    projectId: "p1",
    hostId: "https:site.example:443",
    hostUrl: "https://site.example/",
    connectedByUserId: "u1",
    yandexAccountId: "ya-1",
  };
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
    readFileSync("drizzle/sqlite/0065_lethal_miss_america.sql", "utf8"),
  );
  state.yandexConnection = null;
  state.gscConnection = null;
  state.getExternalLinksHistory.mockResolvedValue(HISTORY);
  state.getExternalLinksSamples.mockResolvedValue({
    count: 2,
    links: SAMPLE_LINKS,
  });
});

describe("WebmasterBacklinksService.getBacklinks", () => {
  it("collects when nothing is stored, then serves reads without further API calls", async () => {
    connectYandex();

    const first = await WebmasterBacklinksService.getBacklinks({
      projectId: "p1",
    });
    expect(first.yandex).toMatchObject({
      connected: true,
      hostUrl: "https://site.example/",
      latest: { date: "2026-02-01", linksTotalCount: 55 },
      storedSamplesCount: 2,
      samplesTruncated: false,
    });
    expect(first.yandex.history).toEqual(HISTORY);
    expect(first.yandex.samples).toEqual(SAMPLE_LINKS);
    expect(first.yandex.lastCollectedAt).not.toBeNull();
    expect(first.gsc).toEqual({
      connected: false,
      siteUrl: null,
      apiProvidesLinks: false,
    });

    state.getExternalLinksHistory.mockClear();
    state.getExternalLinksSamples.mockClear();
    const second = await WebmasterBacklinksService.getBacklinks({
      projectId: "p1",
    });
    expect(second.yandex.connected).toBe(true);
    expect(second.yandex.storedSamplesCount).toBe(2);
    expect(state.getExternalLinksHistory).not.toHaveBeenCalled();
    expect(state.getExternalLinksSamples).not.toHaveBeenCalled();
  });

  it("reports both webmasters' connection state when Yandex is not connected", async () => {
    state.gscConnection = { siteUrl: "sc-domain:site.example" };

    const result = await WebmasterBacklinksService.getBacklinks({
      projectId: "p1",
    });
    expect(result.yandex).toMatchObject({
      connected: false,
      unavailableReason: null,
      history: [],
    });
    expect(result.gsc).toEqual({
      connected: true,
      siteUrl: "sc-domain:site.example",
      apiProvidesLinks: false,
    });
    expect(state.getExternalLinksHistory).not.toHaveBeenCalled();
  });

  it("degrades to disconnected with a reason on a dead grant, hiding stale counts", async () => {
    connectYandex();
    await WebmasterBacklinksService.getBacklinks({ projectId: "p1" });
    // Simulate staleness so the next read re-collects.
    state.database!.exec(
      "UPDATE webmaster_backlink_snapshots SET captured_at = '2000-01-01T00:00:00.000Z'",
    );
    state.getExternalLinksHistory.mockRejectedValue(
      new YandexWebmasterTokenError("Could not mint a Yandex Webmaster token"),
    );

    const result = await WebmasterBacklinksService.getBacklinks({
      projectId: "p1",
    });
    expect(result.yandex).toMatchObject({
      connected: false,
      unavailableReason: "Could not mint a Yandex Webmaster token",
      history: [],
      latest: null,
    });
  });

  it("keeps stored data with a collectError when an unexpected refresh failure hits", async () => {
    connectYandex();
    await WebmasterBacklinksService.getBacklinks({ projectId: "p1" });
    state.database!.exec(
      "UPDATE webmaster_backlink_snapshots SET captured_at = '2000-01-01T00:00:00.000Z'",
    );
    state.getExternalLinksHistory.mockRejectedValue(
      new YandexWebmasterApiError(500, "Yandex Webmaster API error (500)."),
    );

    const result = await WebmasterBacklinksService.getBacklinks({
      projectId: "p1",
    });
    expect(result.yandex.connected).toBe(true);
    expect(result.yandex.collectError).toBe(
      "Yandex Webmaster API error (500).",
    );
    expect(result.yandex.latest).toEqual({
      date: "2026-02-01",
      linksTotalCount: 55,
    });
    expect(result.yandex.samples).toHaveLength(2);
  });

  it("caps sample collection at five pages of 100 and stops on a short page", async () => {
    connectYandex();
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      sourceUrl: `https://s${i}.example/`,
      destinationUrl: "https://site.example/",
      discoveryDate: null,
      sourceLastAccessDate: null,
    }));
    state.getExternalLinksSamples.mockImplementation(async (_hostId, input) => {
      // Full pages for offsets 0..399, then a short final page.
      if (input.offset < 400)
        return {
          count: 502,
          links: fullPage.map((l) => ({
            ...l,
            sourceUrl: `${l.sourceUrl}${input.offset}`,
          })),
        };
      return { count: 502, links: fullPage.slice(0, 3) };
    });

    const result = await WebmasterBacklinksService.getBacklinks({
      projectId: "p1",
    });
    expect(state.getExternalLinksSamples).toHaveBeenCalledTimes(5);
    expect(result.yandex.storedSamplesCount).toBe(403);
    expect(result.yandex.samplesTruncated).toBe(false);
  });
});
