import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSerpResultsTool } from "./get-serp-results";
import { makeToolContext, textContent } from "./tool-test-support";
import type * as r2CacheModule from "@/server/lib/r2-cache";

const mocks = vi.hoisted(() => ({
  createDataforseoClient: vi.fn(),
  getProjectForOrganization: vi.fn(),
  resolveSerpProvider: vi.fn(),
  serperSearch: vi.fn(),
  cache: new Map<string, unknown>(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: (promise: Promise<unknown>) => promise,
}));
vi.mock("@/server/lib/r2-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof r2CacheModule>()),
  getCached: async (key: string) => mocks.cache.get(key) ?? null,
  setCached: async (key: string, value: unknown) => {
    mocks.cache.set(key, value);
  },
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: mocks.createDataforseoClient,
  SERP_ANALYSIS_DEPTH: 20,
}));
vi.mock("@/server/lib/seo-providers/routing", () => ({
  resolveSerpProvider: mocks.resolveSerpProvider,
}));
vi.mock("@/server/lib/seo-providers/serper/client", () => ({
  serperSearch: mocks.serperSearch,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

const toolContext = makeToolContext();

function mockLiveSerp(rows: number) {
  const live = vi.fn().mockResolvedValue(
    Array.from({ length: rows }, (_, index) => ({
      type: "organic",
      rank_absolute: index + 1,
      title: `Result ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      domain: "example.com",
      description: "desc",
    })),
  );
  mocks.createDataforseoClient.mockReturnValue({ serp: { live } });
  return live;
}

describe("get_serp_results", () => {
  beforeEach(() => {
    mocks.cache.clear();
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      locationCode: 2840,
      languageCode: "en",
    });
    // The incumbent path stays the default for the existing tests; the
    // serper tests override this per test.
    mocks.resolveSerpProvider.mockResolvedValue("dataforseo");
  });

  it("crawls and returns rows to the requested depth", async () => {
    const live = mockLiveSerp(40);

    const result = await getSerpResultsTool.handler(
      {
        projectId: "project_1",
        queries: [{ keyword: "seo tools" }],
        depth: 30,
      },
      toolContext,
    );

    expect(live).toHaveBeenCalledWith(expect.objectContaining({ depth: 30 }));
    // Rows are trimmed to the depth that was crawled, not the fixed top 20.
    expect(textContent(result)).toContain('"seo tools" (30 results)');
  });

  it("answers a repeated query from the saved rows without another paid call", async () => {
    const live = mockLiveSerp(20);
    const args = {
      projectId: "project_1",
      queries: [{ keyword: "seo tools" }],
    };

    const first = await getSerpResultsTool.handler(args, toolContext);
    const repeat = await getSerpResultsTool.handler(args, toolContext);

    expect(live).toHaveBeenCalledTimes(1);
    expect(repeat.structuredContent).toEqual(first.structuredContent);
  });

  it("fetches a mobile SERP separately from a saved desktop one", async () => {
    const live = mockLiveSerp(20);
    const query = { projectId: "project_1" };

    await getSerpResultsTool.handler(
      { ...query, queries: [{ keyword: "seo tools" }] },
      toolContext,
    );
    await getSerpResultsTool.handler(
      { ...query, queries: [{ keyword: "seo tools", device: "mobile" }] },
      toolContext,
    );

    expect(live).toHaveBeenCalledTimes(2);
    expect(live).toHaveBeenLastCalledWith(
      expect.objectContaining({ device: "mobile" }),
    );
  });

  it("serves organic rows from serper mapped into the tool schema", async () => {
    mocks.resolveSerpProvider.mockResolvedValue("serper");
    mocks.serperSearch.mockResolvedValue({
      organic: [
        {
          position: 1,
          title: "Best SEO Tools",
          link: "https://www.example.com/tools",
          snippet: "A curated list.",
        },
      ],
    });

    const result = await getSerpResultsTool.handler(
      { projectId: "project_1", queries: [{ keyword: "seo tools" }] },
      toolContext,
    );

    expect(mocks.resolveSerpProvider).toHaveBeenCalledWith("google", {
      cityLevel: false,
    });
    expect(mocks.serperSearch).toHaveBeenCalledWith({
      keyword: "seo tools",
      country: "us",
      language: "en",
      depth: 20,
    });
    expect(mocks.createDataforseoClient).not.toHaveBeenCalled();
    const row = result.structuredContent?.results[0];
    expect(row?.ok).toBe(true);
    if (row?.ok) {
      expect(row.items[0]).toEqual({
        type: "organic",
        rank: 1,
        organicRank: 1,
        title: "Best SEO Tools",
        url: "https://www.example.com/tools",
        domain: "example.com",
        description: "A curated list.",
      });
    }
  });

  it("reports the resolver's error per query instead of a metered fallback", async () => {
    mocks.resolveSerpProvider.mockRejectedValue(
      new Error(
        'No SERP provider configured for engine "google". Set one of: SERPER_API_KEY, DATAFORSEO_API_KEY.',
      ),
    );

    const result = await getSerpResultsTool.handler(
      { projectId: "project_1", queries: [{ keyword: "seo tools" }] },
      toolContext,
    );

    expect(mocks.createDataforseoClient).not.toHaveBeenCalled();
    const failed = result.structuredContent?.results[0];
    expect(failed?.ok).toBe(false);
    if (failed && !failed.ok) {
      expect(failed.error).toContain("No SERP provider configured");
    }
  });
});
