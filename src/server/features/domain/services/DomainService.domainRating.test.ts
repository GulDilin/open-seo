import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { backlinksSummaryMock, ahrefsRatingMock, workersEnv } = vi.hoisted(
  () => ({
    backlinksSummaryMock: vi.fn(),
    ahrefsRatingMock: vi.fn(),
    workersEnv: {} as Record<string, unknown>,
  }),
);

// The rating refresh reuses the Backlinks page's overview lookup; its
// DataForSEO client and R2 cache are the network/billing boundary mocked here.
// The Ahrefs DR fallback is mocked at the same boundary (it fetches and caches
// in KV).
vi.mock("cloudflare:workers", () => ({
  env: workersEnv,
  waitUntil: vi.fn(),
}));
vi.mock("@/server/lib/ahrefs", () => ({
  getAhrefsDomainRating: ahrefsRatingMock,
}));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: vi.fn(
    async (prefix: string, params: Record<string, unknown>) =>
      `${prefix}:${JSON.stringify(params)}`,
  ),
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => undefined),
}));
vi.mock("@/server/lib/dataforseo", () => ({
  normalizeBacklinksTarget: vi.fn(() => ({
    apiTarget: "example.com",
    displayTarget: "example.com",
    scope: "subdomains",
    includeSubdomains: true,
    path: "",
  })),
  createDataforseoClient: vi.fn(() => ({
    backlinks: {
      summary: backlinksSummaryMock,
      history: vi.fn(async () => []),
    },
  })),
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

const billingCustomer = {
  organizationId: "org_123",
  userId: "user_123",
  userEmail: "team@example.com",
};

function insertSnapshot(values: {
  domain: string;
  rank: number | null;
  capturedAt: string;
}) {
  state
    .database!.prepare(
      "INSERT INTO backlink_snapshots (project_id, domain, rank, captured_at) VALUES (?, ?, ?, ?)",
    )
    .run("project_123", values.domain, values.rank, values.capturedAt);
}

beforeEach(() => {
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    CREATE TABLE backlink_snapshots (
      id integer PRIMARY KEY AUTOINCREMENT,
      project_id text NOT NULL,
      domain text NOT NULL,
      rank integer,
      backlinks integer,
      referring_domains integer,
      broken_backlinks integer,
      new_backlinks integer,
      lost_backlinks integer,
      new_referring_domains integer,
      lost_referring_domains integer,
      captured_at text NOT NULL
    );
  `);
  // Ahrefs has no rating unless a test asks for one.
  ahrefsRatingMock.mockResolvedValue(null);
});

describe("getProjectDomainRating", () => {
  it("serves a fresh snapshot for the current domain without a refresh", async () => {
    insertSnapshot({
      domain: "example.com",
      rank: 42,
      capturedAt: new Date().toISOString(),
    });

    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: "example.com" },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: "example.com",
      rank: 42,
      source: "dataforseo",
      reason: null,
    });
    expect(backlinksSummaryMock).not.toHaveBeenCalled();
    expect(ahrefsRatingMock).not.toHaveBeenCalled();
  });

  it("refreshes through the backlinks overview when the snapshot is for another domain", async () => {
    insertSnapshot({
      domain: "old-site.com",
      rank: 42,
      capturedAt: new Date().toISOString(),
    });
    backlinksSummaryMock.mockResolvedValue({ rank: 77 });

    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: "example.com" },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: "example.com",
      rank: 77,
      source: "dataforseo",
      reason: null,
    });
    expect(ahrefsRatingMock).not.toHaveBeenCalled();
  });

  it("falls back to the Ahrefs DR when DataForSEO fails", async () => {
    backlinksSummaryMock.mockRejectedValue(new Error("no provider key"));
    ahrefsRatingMock.mockResolvedValue(55);

    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: "example.com" },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: "example.com",
      rank: 55,
      source: "ahrefs",
      reason: null,
    });
  });

  it("leads with the Ahrefs DR when the deployment configured its key", async () => {
    workersEnv.AHREFS_API_KEY = "ahrefs-key";
    backlinksSummaryMock.mockRejectedValue(
      new Error("must not be reached while Ahrefs answers"),
    );
    ahrefsRatingMock.mockResolvedValue(55);
    try {
      const result = await DomainService.getProjectDomainRating(
        { projectId: "project_123", domain: "example.com" },
        billingCustomer,
      );

      expect(result).toEqual({
        domain: "example.com",
        rank: 55,
        source: "ahrefs",
        reason: null,
      });
      expect(backlinksSummaryMock).not.toHaveBeenCalled();
    } finally {
      delete workersEnv.AHREFS_API_KEY;
    }
  });

  it("falls back to the Ahrefs DR when DataForSEO has no rank for the site", async () => {
    backlinksSummaryMock.mockResolvedValue({ rank: null });
    ahrefsRatingMock.mockResolvedValue(55);

    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: "example.com" },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: "example.com",
      rank: 55,
      source: "ahrefs",
      reason: null,
    });
  });

  it("reports the DataForSEO failure when both providers fail", async () => {
    backlinksSummaryMock.mockRejectedValue(new Error("no provider key"));
    ahrefsRatingMock.mockRejectedValue(new Error("Ahrefs down"));

    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: "example.com" },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: "example.com",
      rank: null,
      source: null,
      reason: "no provider key",
    });
  });

  it("reports a zero Ahrefs DR as a real rating, not an absence", async () => {
    // DataForSEO failed, but the Ahrefs DR of 0 is an honest answer: a domain
    // with no backlink profile in Ahrefs' index yet.
    backlinksSummaryMock.mockRejectedValue(new Error("no provider key"));
    ahrefsRatingMock.mockResolvedValue(0);

    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: "example.com" },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: "example.com",
      rank: 0,
      source: "ahrefs",
      reason: null,
    });
  });

  it("does not blame a failed provider when the other answered with no rank", async () => {
    // DataForSEO rated the domain at nothing; the Ahrefs error is about a
    // fallback that never answered, not why the card is empty.
    backlinksSummaryMock.mockResolvedValue({ rank: null });
    ahrefsRatingMock.mockRejectedValue(new Error("Ahrefs down"));

    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: "example.com" },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: "example.com",
      rank: null,
      source: null,
      reason: "No rating for this domain yet — the Backlinks page refreshes it",
    });
  });

  it("returns a null rank without a project website", async () => {
    const result = await DomainService.getProjectDomainRating(
      { projectId: "project_123", domain: null },
      billingCustomer,
    );

    expect(result).toEqual({
      domain: null,
      rank: null,
      source: null,
      reason: null,
    });
    expect(ahrefsRatingMock).not.toHaveBeenCalled();
  });
});
