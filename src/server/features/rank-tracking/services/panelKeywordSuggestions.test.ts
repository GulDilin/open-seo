import { beforeEach, expect, it, vi } from "vitest";
import { PanelKeywordSuggestions } from "./panelKeywordSuggestions";
import { GscService } from "@/server/features/gsc/services/GscService";
import { YandexWebmasterService } from "@/server/features/yandex/services/YandexWebmasterService";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";

vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getConnection: vi.fn(), getPerformance: vi.fn() },
}));
vi.mock("@/server/features/yandex/services/YandexWebmasterService", () => ({
  YandexWebmasterService: {
    getConnection: vi.fn(),
    getSearchPerformance: vi.fn(),
  },
}));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({
    RankTrackingRepository: { getKeywordsForActiveConfigs: vi.fn() },
  }),
);

const gscConnection = {
  id: "gsc-conn",
  projectId: "p1",
  organizationId: "org",
  siteUrl: "sc-domain:example.com",
  connectedByUserId: "u1",
  gscAccountId: null,
  connectedAccountEmail: null,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

const yandexConnection = {
  id: "ya-conn",
  projectId: "p1",
  organizationId: "org",
  hostId: "https:example.com:443",
  hostUrl: "https://example.com/",
  connectedByUserId: "u1",
  yandexAccountId: null,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

const gscPerformance = (
  rows: Array<{ keys: string[]; impressions: number; clicks: number }>,
) => ({
  siteUrl: gscConnection.siteUrl,
  connectedBy: null,
  request: { startDate: "2026-09-28", endDate: "2026-10-25" },
  rows: rows.map((row) => ({ ...row, ctr: 0.1, position: 7 })),
});

const yandexPerformance = (
  rows: Array<{
    query: string;
    impressions: number | null;
    clicks: number | null;
    avgShowPosition?: number | null;
  }>,
) => ({
  hostUrl: yandexConnection.hostUrl,
  orderBy: "impressions" as const,
  deviceType: "all" as const,
  reportedDateFrom: "2026-09-28",
  reportedDateTo: "2026-10-25",
  totalCount: rows.length,
  rows: rows.map((row, i) => ({
    queryId: `q${i}`,
    query: row.query,
    impressions: row.impressions,
    clicks: row.clicks,
    avgShowPosition: row.avgShowPosition ?? null,
    avgClickPosition: null,
  })),
  summary: null,
  indexingStatus: null,
});

beforeEach(() => {
  vi.mocked(GscService.getConnection).mockResolvedValue(null);
  vi.mocked(YandexWebmasterService.getConnection).mockResolvedValue(null);
  vi.mocked(GscService.getPerformance).mockResolvedValue(gscPerformance([]));
  vi.mocked(YandexWebmasterService.getSearchPerformance).mockResolvedValue(
    yandexPerformance([]),
  );
  vi.mocked(
    RankTrackingRepository.getKeywordsForActiveConfigs,
  ).mockResolvedValue([]);
});

it("merges both panels, drops already-tracked keywords, and sorts by impressions", async () => {
  vi.mocked(GscService.getConnection).mockResolvedValue(gscConnection);
  vi.mocked(YandexWebmasterService.getConnection).mockResolvedValue(
    yandexConnection,
  );
  vi.mocked(GscService.getPerformance).mockResolvedValue(
    gscPerformance([
      { keys: ["widget pro"], impressions: 800, clicks: 5 },
      { keys: ["already tracked"], impressions: 5000, clicks: 10 },
    ]),
  );
  vi.mocked(YandexWebmasterService.getSearchPerformance).mockResolvedValue(
    yandexPerformance([
      { query: "виджеты", impressions: 3000, clicks: 40, avgShowPosition: 6.2 },
      { query: "ALREADY TRACKED", impressions: 900, clicks: 1 },
    ]),
  );
  vi.mocked(
    RankTrackingRepository.getKeywordsForActiveConfigs,
  ).mockResolvedValue([{ keyword: "Already Tracked" }]);

  const result = await PanelKeywordSuggestions.get({ projectId: "p1" });

  expect(result.sources).toEqual(["gsc", "yandex_webmaster"]);
  expect(result.suggestions).toEqual([
    {
      query: "виджеты",
      source: "yandex_webmaster",
      impressions: 3000,
      clicks: 40,
      position: 6.2,
    },
    {
      query: "widget pro",
      source: "gsc",
      impressions: 800,
      clicks: 5,
      position: 7,
    },
  ]);
  // Both panels are queried on the ~30-day query window.
  expect(GscService.getPerformance).toHaveBeenCalledWith(
    expect.objectContaining({
      dimensions: ["query"],
      dateRange: "last_28_days",
    }),
  );
  expect(YandexWebmasterService.getSearchPerformance).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: "p1",
      dateRange: "last_28_days",
      orderBy: "impressions",
    }),
  );
});

it("keeps the higher-impressions panel when both report a query", async () => {
  vi.mocked(GscService.getConnection).mockResolvedValue(gscConnection);
  vi.mocked(YandexWebmasterService.getConnection).mockResolvedValue(
    yandexConnection,
  );
  vi.mocked(GscService.getPerformance).mockResolvedValue(
    gscPerformance([{ keys: ["boost"], impressions: 100, clicks: 2 }]),
  );
  vi.mocked(YandexWebmasterService.getSearchPerformance).mockResolvedValue(
    yandexPerformance([{ query: "boost", impressions: 900, clicks: 3 }]),
  );

  const result = await PanelKeywordSuggestions.get({ projectId: "p1" });

  expect(result.suggestions).toEqual([
    {
      query: "boost",
      source: "yandex_webmaster",
      impressions: 900,
      clicks: 3,
      position: null,
    },
  ]);
});

it("caps suggestions at 50", async () => {
  vi.mocked(YandexWebmasterService.getConnection).mockResolvedValue(
    yandexConnection,
  );
  vi.mocked(YandexWebmasterService.getSearchPerformance).mockResolvedValue(
    yandexPerformance(
      Array.from({ length: 60 }, (_, i) => ({
        query: `q${i}`,
        impressions: 60 - i,
        clicks: 1,
      })),
    ),
  );

  const result = await PanelKeywordSuggestions.get({ projectId: "p1" });

  expect(result.suggestions).toHaveLength(50);
  expect(result.suggestions[0]).toMatchObject({ query: "q0", impressions: 60 });
  expect(result.suggestions[49]).toMatchObject({
    query: "q49",
    impressions: 11,
  });
});

it("returns empty suggestions and sources without error when no panel is connected", async () => {
  const result = await PanelKeywordSuggestions.get({ projectId: "p1" });

  expect(result).toEqual({ suggestions: [], sources: [] });
  expect(GscService.getPerformance).not.toHaveBeenCalled();
  expect(YandexWebmasterService.getSearchPerformance).not.toHaveBeenCalled();
});

it("skips panels whose site doesn't cover the tracked domain", async () => {
  vi.mocked(GscService.getConnection).mockResolvedValue({
    ...gscConnection,
    siteUrl: "sc-domain:other.com",
  });
  vi.mocked(YandexWebmasterService.getConnection).mockResolvedValue({
    ...yandexConnection,
    hostUrl: "https://www.example.com/",
  });
  vi.mocked(YandexWebmasterService.getSearchPerformance).mockResolvedValue(
    yandexPerformance([{ query: "widgets", impressions: 50, clicks: 2 }]),
  );

  const result = await PanelKeywordSuggestions.get({
    projectId: "p1",
    domain: "example.com",
  });

  expect(result.sources).toEqual(["yandex_webmaster"]);
  expect(GscService.getPerformance).not.toHaveBeenCalled();
  expect(result.suggestions[0]).toMatchObject({
    query: "widgets",
    source: "yandex_webmaster",
  });
});

it("keeps the other panel's suggestions when one panel fetch fails", async () => {
  vi.mocked(GscService.getConnection).mockResolvedValue(gscConnection);
  vi.mocked(YandexWebmasterService.getConnection).mockResolvedValue(
    yandexConnection,
  );
  vi.mocked(GscService.getPerformance).mockRejectedValue(
    new Error("search console down"),
  );
  vi.mocked(YandexWebmasterService.getSearchPerformance).mockResolvedValue(
    yandexPerformance([{ query: "виджеты", impressions: 120, clicks: 4 }]),
  );

  const result = await PanelKeywordSuggestions.get({ projectId: "p1" });

  expect(result.sources).toEqual(["gsc", "yandex_webmaster"]);
  expect(result.suggestions).toEqual([
    {
      query: "виджеты",
      source: "yandex_webmaster",
      impressions: 120,
      clicks: 4,
      position: null,
    },
  ]);
});
