import { beforeEach, describe, expect, it, vi } from "vitest";

const rankOverviewMock = vi.fn();
const backlinksSummaryMock = vi.fn();

// The overview's organic metrics and the Backlinks page's summary cache are
// the network/billing boundary mocked here. R2 values are served by key
// prefix so tests control which cache holds data.
vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: vi.fn() }));
let r2ByPrefix: Record<string, unknown> = {};
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: vi.fn(
    async (prefix: string, params: Record<string, unknown>) =>
      `${prefix}:${JSON.stringify(params)}`,
  ),
  getCached: vi.fn(async (key: string) => {
    const prefix = Object.keys(r2ByPrefix).find((p) => key.startsWith(p));
    return prefix ? (r2ByPrefix[prefix] ?? null) : null;
  }),
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
    domain: { rankOverview: rankOverviewMock },
    backlinks: { summary: backlinksSummaryMock },
  })),
}));
vi.mock("@/db", () => ({ db: undefined }));

import { DomainService } from "./DomainService";

const billingCustomer = {
  organizationId: "org_123",
  userId: "user_123",
  userEmail: "team@example.com",
};

const input = {
  projectId: "project_123",
  domain: "example.com",
  scope: "subdomains" as const,
  locationCode: 2840,
  languageCode: "en",
};

/** The Backlinks page's cached overview envelope, as profileOverview writes it. */
function summaryCacheFixture(
  overrides: { backlinks?: number; referringDomains?: number } = {},
) {
  return {
    overview: {
      target: "example.com",
      displayTarget: "example.com",
      scope: "subdomains",
      summary: {
        rank: 71,
        backlinks: overrides.backlinks ?? 1200,
        referringPages: null,
        referringDomains: overrides.referringDomains ?? 340,
        brokenBacklinks: null,
        brokenPages: null,
        backlinksSpamScore: null,
        targetSpamScore: null,
        newBacklinks: null,
        lostBacklinks: null,
        newReferringDomains: null,
        lostReferringDomains: null,
      },
      trends: [],
      newLostTrends: [],
      fetchedAt: new Date().toISOString(),
    },
  };
}

beforeEach(() => {
  r2ByPrefix = {};
  rankOverviewMock.mockResolvedValue([
    { metrics: { organic: { etv: 1234.6, count: 42 } } },
  ]);
});

describe("getOverview backlinks metrics", () => {
  it("fills backlinks metrics from the cached backlinks summary", async () => {
    r2ByPrefix["backlinks:overview:v2"] = summaryCacheFixture();

    const result = await DomainService.getOverview(input, billingCustomer);

    expect(result.backlinks).toBe(1200);
    expect(result.referringDomains).toBe(340);
    expect(backlinksSummaryMock).not.toHaveBeenCalled();
  });

  it("leaves backlinks metrics null without a cached summary, spending nothing on it", async () => {
    const result = await DomainService.getOverview(input, billingCustomer);

    expect(result.backlinks).toBeNull();
    expect(result.referringDomains).toBeNull();
    // Only the overview's own organic lookup is paid for; the backlinks
    // summary is never fetched from here.
    expect(backlinksSummaryMock).not.toHaveBeenCalled();
  });

  it("merges the cached summary into a cached overview result", async () => {
    r2ByPrefix["domain:overview"] = {
      domain: "example.com",
      organicTraffic: 1235,
      organicKeywords: 42,
      backlinks: null,
      referringDomains: null,
      hasData: true,
      fetchedAt: new Date().toISOString(),
    };
    r2ByPrefix["backlinks:overview:v2"] = summaryCacheFixture();

    const result = await DomainService.getOverview(input, billingCustomer);

    expect(result.organicKeywords).toBe(42);
    expect(result.backlinks).toBe(1200);
    expect(rankOverviewMock).not.toHaveBeenCalled();
  });
});
