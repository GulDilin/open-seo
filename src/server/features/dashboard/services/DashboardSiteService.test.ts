import { beforeEach, expect, it, vi } from "vitest";
import { DashboardSiteService } from "./DashboardSiteService";
import { GscService } from "@/server/features/gsc/services/GscService";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";

const providers = vi.hoisted(() => ({ domains: vi.fn(), links: vi.fn() }));
// Read-only store: the dashboard lists stored Yandex samples and must never
// collect, so the mock exposes only the read.
const webmasterBacklinks = vi.hoisted(() => ({ listRecentSamples: vi.fn() }));
// The degradation read owns its collect rules; its service is mocked so the
// dashboard's own mapping is what these tests assert.
const webmasterService = vi.hoisted(() => ({ getRecentSamples: vi.fn() }));
vi.mock("@/server/lib/dataforseo", async () => ({
  ...(await import("@/server/lib/dataforseoBacklinksTarget")),
  createDataforseoClient: () => ({
    backlinks: { referringDomains: providers.domains, rows: providers.links },
  }),
}));
vi.mock(
  "@/server/features/backlinks/repositories/WebmasterBacklinksRepository",
  () => ({ WebmasterBacklinksRepository: webmasterBacklinks }),
);
vi.mock(
  "@/server/features/backlinks/services/WebmasterBacklinksService",
  () => ({ WebmasterBacklinksService: webmasterService }),
);
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: { getByProjectId: vi.fn() },
}));
vi.mock("@/server/features/gsc/services/GscService", async () => ({
  ...(await import("@/server/lib/gscErrors")),
  GscService: { getPerformance: vi.fn() },
  isExpectedGrantFailure: () => false,
}));
vi.mock("./DashboardCacheService", () => ({
  DashboardCacheService: {
    gscNamespace: () => "dashboard:gsc",
    readThrough: async (input: { load: () => Promise<unknown> }) => ({
      value: await input.load(),
    }),
  },
}));

const performanceBase = {
  siteUrl: "sc-domain:example.com",
  connectedBy: null,
  request: { startDate: "2026-09-01", endDate: "2026-10-01" },
};

beforeEach(() => {
  providers.domains.mockResolvedValue({ items: [] });
  providers.links.mockResolvedValue({ items: [] });
  webmasterBacklinks.listRecentSamples.mockResolvedValue([]);
  webmasterService.getRecentSamples.mockResolvedValue({
    connected: false,
    unavailableReason: null,
    collectError: null,
    samples: [],
  });
  vi.mocked(GscConnectionRepository.getByProjectId).mockResolvedValue({
    id: "connection",
    projectId: "project",
    organizationId: "org",
    siteUrl: "sc-domain:example.com",
    connectedByUserId: "user",
    gscAccountId: "account",
    connectedAccountEmail: null,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
  });
  vi.mocked(GscService.getPerformance).mockResolvedValue({
    ...performanceBase,
    rows: [],
  });
});
const row = (query: string, impressions = 10) => ({
  keys: [query],
  clicks: 0,
  impressions,
  ctr: 0,
  position: 12,
});

it("surfaces only queries above the threshold and absent from baseline data", async () => {
  vi.mocked(GscService.getPerformance)
    .mockResolvedValueOnce({
      ...performanceBase,
      rows: [row("new"), row("existing"), row("too small", 9)],
    })
    .mockResolvedValueOnce({ ...performanceBase, rows: [row("existing")] });
  const result = await DashboardSiteService.getEmergingQueries(
    "project",
    "org",
  );
  expect(result.value.rows.map((item) => item.query)).toEqual(["new"]);
});

it("checks capped baseline candidates directly so omitted older queries are not called new", async () => {
  vi.mocked(GscService.getPerformance)
    .mockResolvedValueOnce({
      ...performanceBase,
      rows: [row("older low-click query"), row("new query")],
    })
    .mockResolvedValueOnce({
      ...performanceBase,
      rows: Array.from({ length: 25000 }, (_, index) =>
        row(`baseline ${index}`),
      ),
    })
    .mockResolvedValueOnce({
      ...performanceBase,
      rows: [row("older low-click query")],
    })
    .mockResolvedValueOnce({ ...performanceBase, rows: [] });
  const result = await DashboardSiteService.getEmergingQueries(
    "project",
    "org",
  );
  expect(result.value.rows.map((item) => item.query)).toEqual(["new query"]);
});

const customer = {
  organizationId: "org",
  userId: "user",
  userEmail: "user@example.com",
};
it("shows new referring domains without paying for a fallback backlink request", async () => {
  providers.domains.mockResolvedValue({
    items: [{ domain: "new.example", backlinks: 2 }],
  });
  const result = await DashboardSiteService.getLinkActivity(
    "project",
    "example.com",
    customer,
  );
  expect(result).toMatchObject({
    kind: "domains",
    value: [{ domain: "new.example", backlinks: 2 }],
  });
  expect(providers.links).not.toHaveBeenCalled();
});
it("falls back to new backlinks when there are no new referring domains", async () => {
  providers.links.mockResolvedValue({
    items: [{ url_from: "https://existing.example/new-page" }],
  });
  const result = await DashboardSiteService.getLinkActivity(
    "project",
    "example.com",
    customer,
  );
  expect(result).toMatchObject({
    kind: "links",
    links: [{ urlFrom: "https://existing.example/new-page" }],
  });
});

it("lists stored Yandex links from the same week, read-only, beside the DataForSEO rows", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
  try {
    webmasterBacklinks.listRecentSamples.mockResolvedValue([
      {
        sourceUrl: "https://referring.example/page",
        destinationUrl: "https://site.example/",
        discoveryDate: "2026-11-18",
      },
    ]);
    providers.domains.mockResolvedValue({
      items: [{ domain: "new.example", backlinks: 2 }],
    });
    const result = await DashboardSiteService.getLinkActivity(
      "project",
      "example.com",
      customer,
    );
    expect(webmasterBacklinks.listRecentSamples).toHaveBeenCalledWith(
      "project",
      "yandex_webmaster",
      "2026-11-13",
      25,
    );
    expect(result.yandex).toEqual([
      {
        source: "yandex_webmaster",
        domainFrom: "referring.example",
        urlFrom: "https://referring.example/page",
        urlTo: "https://site.example/",
        anchor: null,
        isDofollow: null,
        domainFromRank: null,
        spamScore: null,
        firstSeen: "2026-11-18",
        lastSeen: "2026-11-18",
      },
    ]);
    expect(result.value).toEqual([
      { domain: "new.example", backlinks: 2, firstSeen: null },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
it("reads Yandex samples only for the new-links view", async () => {
  await DashboardSiteService.getBacklinks(
    { projectId: "project", domain: "example.com", kind: "lost" },
    customer,
  );
  expect(webmasterBacklinks.listRecentSamples).not.toHaveBeenCalled();
});

it("degrades the no-DataForSEO widgets to Yandex samples without a DataForSEO request", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
  try {
    webmasterService.getRecentSamples.mockResolvedValue({
      connected: true,
      unavailableReason: null,
      collectError: null,
      samples: [
        {
          sourceUrl: "https://referring.example/page",
          destinationUrl: "https://site.example/",
          discoveryDate: "2026-11-18",
        },
      ],
    });
    const result = await DashboardSiteService.getWebmasterLinks("project");
    expect(webmasterService.getRecentSamples).toHaveBeenCalledWith({
      projectId: "project",
      fromDate: "2026-10-21",
      limit: 25,
    });
    expect(result).toMatchObject({
      connected: true,
      yandex: [
        {
          source: "yandex_webmaster",
          domainFrom: "referring.example",
          urlFrom: "https://referring.example/page",
          urlTo: "https://site.example/",
          firstSeen: "2026-11-18",
        },
      ],
    });
    expect(providers.domains).not.toHaveBeenCalled();
    expect(providers.links).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("finds new queries beyond Google's default first page", async () => {
  vi.mocked(GscService.getPerformance).mockImplementationOnce(
    async (input) => ({
      ...performanceBase,
      rows: input.rowLimit === 25000 ? [row("new zero-click query")] : [],
    }),
  );
  const result = await DashboardSiteService.getEmergingQueries(
    "project",
    "org",
  );
  expect(result.value.rows.map((item) => item.query)).toEqual([
    "new zero-click query",
  ]);
});

it("lists the site's Search Console keywords with Google's position, without a provider request", async () => {
  vi.mocked(GscService.getPerformance).mockResolvedValue({
    ...performanceBase,
    rows: [row("existing keyword", 123)],
  });
  const result = await DashboardSiteService.getKeywords("project", "org");
  expect(result.value.rows).toEqual([
    { query: "existing keyword", clicks: 0, impressions: 123, position: 12 },
  ]);
  expect(providers.domains).not.toHaveBeenCalled();
  expect(providers.links).not.toHaveBeenCalled();
});
