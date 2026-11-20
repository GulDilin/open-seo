import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YandexWebmasterApiError } from "@/server/lib/yandexWebmasterErrors";

const mocks = vi.hoisted(() => ({
  getSqi: vi.fn(),
  getCached: vi.fn<() => Promise<unknown>>(),
  setCached: vi.fn(async () => undefined),
}));

// The SQI lookup's network boundary is the Webmaster client; the R2 cache is
// its storage boundary. Both are mocked; the connection row is real SQLite.
vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: vi.fn() }));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: vi.fn(
    async (prefix: string, params: Record<string, unknown>) =>
      `${prefix}:${JSON.stringify(params)}`,
  ),
  getCached: mocks.getCached,
  setCached: mocks.setCached,
}));
vi.mock("@/server/lib/dataforseo", () => ({
  normalizeBacklinksTarget: vi.fn(),
  createDataforseoClient: vi.fn(),
}));
vi.mock("@/server/lib/yandexWebmasterClient", () => ({
  createYandexWebmasterClient: vi.fn(() => ({ getSqi: mocks.getSqi })),
}));

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
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

import { DomainService } from "./DomainService";

function insertConnection() {
  state
    .database!.prepare(
      `INSERT INTO yandex_connections (id, project_id, organization_id, host_id, host_url, connected_by_user_id, yandex_account_id)
     VALUES ('yc_1', 'project_123', 'org_123', 'https:example.com:443', 'https://example.com/', 'user_123', 'uid_1')`,
    )
    .run();
}

beforeEach(() => {
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    CREATE TABLE yandex_connections (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      organization_id text NOT NULL,
      host_id text NOT NULL,
      host_url text NOT NULL,
      connected_by_user_id text NOT NULL,
      yandex_account_id text,
      created_at text NOT NULL DEFAULT (current_timestamp),
      updated_at text NOT NULL DEFAULT (current_timestamp)
    );
  `);
  mocks.getCached.mockResolvedValue(null);
});

describe("getProjectSqi", () => {
  it("reports not connected without asking Yandex", async () => {
    const result = await DomainService.getProjectSqi({
      projectId: "project_123",
    });

    expect(result).toEqual({
      connected: false,
      hostUrl: null,
      sqi: null,
      unavailableReason: null,
    });
    expect(mocks.getSqi).not.toHaveBeenCalled();
  });

  it("fetches SQI from Webmaster and caches it", async () => {
    insertConnection();
    mocks.getSqi.mockResolvedValue(30);

    const result = await DomainService.getProjectSqi({
      projectId: "project_123",
    });

    expect(result).toEqual({
      connected: true,
      hostUrl: "https://example.com/",
      sqi: 30,
      unavailableReason: null,
    });
    expect(mocks.setCached).toHaveBeenCalledTimes(1);
  });

  it("serves a cached value without asking Yandex again", async () => {
    insertConnection();
    mocks.getCached.mockResolvedValue({
      sqi: 30,
      fetchedAt: "2026-11-01T00:00:00Z",
    });

    const result = await DomainService.getProjectSqi({
      projectId: "project_123",
    });

    expect(result.sqi).toBe(30);
    expect(mocks.getSqi).not.toHaveBeenCalled();
  });

  it("surfaces a dead grant as disconnected with the reason", async () => {
    insertConnection();
    mocks.getSqi.mockRejectedValue(
      new YandexWebmasterApiError(403, "Yandex Webmaster denied access."),
    );

    const result = await DomainService.getProjectSqi({
      projectId: "project_123",
    });

    expect(result.connected).toBe(false);
    expect(result.sqi).toBeNull();
    expect(result.unavailableReason).toBe("Yandex Webmaster denied access.");
  });
});
