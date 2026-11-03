import { beforeEach, describe, expect, it, vi } from "vitest";
import { YandexWebmasterNotConnectedError } from "@/server/lib/yandexWebmasterErrors";
import * as yandexTools from "./yandex-webmaster-tools";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  hasYandexOAuthConfig: vi.fn(),
  getSearchPerformance: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/yandex/yandexOAuth", () => ({
  hasYandexOAuthConfig: mocks.hasYandexOAuthConfig,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/yandex/services/YandexWebmasterService", () => ({
  YandexWebmasterService: {
    getSearchPerformance: mocks.getSearchPerformance,
  },
}));

const toolContext = makeToolContext();
const args = { projectId: "project_1" };

describe("yandex webmaster MCP tool", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      locationCode: 149,
      languageCode: "ru",
    });
    mocks.hasYandexOAuthConfig.mockResolvedValue(true);
  });

  it("returns rows plus summary and the honest limitations", async () => {
    mocks.getSearchPerformance.mockResolvedValue({
      hostUrl: "https://ya.ru/",
      orderBy: "clicks",
      deviceType: "all",
      reportedDateFrom: "2026-09-20",
      reportedDateTo: "2026-10-16",
      totalCount: 3000,
      rows: [
        {
          queryId: "a08b",
          query: "яндекс",
          impressions: 1200,
          clicks: 30,
          avgShowPosition: 3.2,
          avgClickPosition: 1.9,
        },
      ],
      summary: {
        sqi: 100,
        searchablePagesCount: 42,
        excludedPagesCount: 7,
        problems: {
          fatal: 0,
          critical: 1,
          possibleProblem: 2,
          recommendation: 3,
        },
      },
      indexingStatus: "OK",
    });

    const result = await yandexTools.getYandexSearchPerformanceTool.handler(
      args,
      toolContext,
    );
    const text = textContent(result);
    const structured = JSON.stringify(result.structuredContent);

    expect(result.structuredContent).toMatchObject({
      ok: true,
      hostUrl: "https://ya.ru/",
      rowCount: 1,
      totalCount: 3000,
      rows: [{ query: "яндекс", ctr: 0.025 }],
    });
    expect(text).toContain("2026-09-20→2026-10-16");
    expect(text).toContain("floors, not exhaustive");
    expect(structured).toContain("indexingStatus");
  });

  it("answers not_connected with a connect link", async () => {
    mocks.getSearchPerformance.mockRejectedValue(
      new YandexWebmasterNotConnectedError("project_1"),
    );

    const result = await yandexTools.getYandexSearchPerformanceTool.handler(
      args,
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "not_connected",
      connectUrl: "https://open-seo.test/p/project_1/search-performance",
    });
    expect(textContent(result)).toContain("not connected");
  });

  it("gates on missing self-hosted OAuth configuration before any lookup", async () => {
    mocks.hasYandexOAuthConfig.mockResolvedValue(false);

    const result = await yandexTools.getYandexSearchPerformanceTool.handler(
      args,
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "yandex_oauth_not_configured",
    });
    expect(mocks.getSearchPerformance).not.toHaveBeenCalled();
  });

  it("rejects a half-specified explicit window", async () => {
    const result = await yandexTools.getYandexSearchPerformanceTool.handler(
      { ...args, startDate: "2026-09-01" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "invalid_request",
    });
  });
});
