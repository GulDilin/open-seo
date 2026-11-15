import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { googleAdsVolumesProvider } from "./volumes";
import { generateKeywordIdeas } from "./client";

const envMocks = vi.hoisted(() => ({
  getOptionalEnvValue: vi.fn(),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: envMocks.getOptionalEnvValue,
}));

beforeEach(() => {
  envMocks.getOptionalEnvValue.mockImplementation(
    async (name: string) =>
      ({
        GOOGLE_ADS_REFRESH_TOKEN: "refresh",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_ADS_CUSTOMER_ID: "1234567890",
      })[name],
  );
});

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

/** Ideas response shape per the REST schema: stringified int64 metrics. */
function ideasResponse(results: unknown[]): Response {
  return okResponse({ results });
}

/** The OAuth token exchange followed by one generateKeywordIdeas call. */
function stubIdeasFetch(ideas: Response): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>();
  fetchMock
    .mockResolvedValueOnce(okResponse({ access_token: "token" }))
    .mockResolvedValueOnce(ideas);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Serialized JSON body of a fetch call (our clients post string bodies). */
function requestBody(call: Parameters<typeof fetch>): unknown {
  const body = call[1]?.body;
  return JSON.parse(typeof body === "string" ? body : "null");
}

describe("googleAdsVolumesProvider.getVolumes", () => {
  it("maps exact-phrase ideas to rows with cpc and trend, no competition numbers", async () => {
    const fetchMock = stubIdeasFetch(
      ideasResponse([
        {
          text: "hiking boots",
          keywordIdeaMetrics: {
            avgMonthlySearches: "1000", // bucketed without ad spend
            averageCpcMicros: "2500000",
            monthlySearchVolumes: [
              { year: "2025", month: "JANUARY", monthlySearches: "900" },
            ],
          },
        },
        { text: "other", keywordIdeaMetrics: { avgMonthlySearches: "10" } },
      ]),
    );

    const rows = await googleAdsVolumesProvider.getVolumes([
      { keyword: "hiking boots", country: "no", language: "en" },
      { keyword: "missing phrase", country: "no", language: "en" },
    ]);

    // Norway (2578) resolved from ISO and sent as the geo criterion.
    expect(requestBody(fetchMock.mock.calls[1])).toMatchObject({
      geoTargetConstants: ["geoTargetConstants/2578"],
    });
    expect(rows[0]).toEqual({
      keyword: "hiking boots",
      volume: 1000,
      cpc: 2.5,
      competition: null,
      difficulty: null,
      monthly: [{ year: 2025, month: 1, searchVolume: 900 }],
      source: "google_ads",
    });
    // Keywords the idea call doesn't return keep explicit null volume.
    expect(rows[1].volume).toBeNull();
    expect(rows[1].monthly).toEqual([]);
  });

  it("rejects countries outside the market registry before any API call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleAdsVolumesProvider.getVolumes([
        { keyword: "x", country: "zz", language: "en" },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("generateKeywordIdeas", () => {
  it("sends the live REST contract and maps months/cpc", async () => {
    const fetchMock = stubIdeasFetch(
      ideasResponse([
        {
          text: "hiking boots",
          keywordIdeaMetrics: {
            avgMonthlySearches: "1000",
            competition: "MEDIUM",
            averageCpcMicros: "1234500",
            monthlySearchVolumes: [
              { year: "2025", month: "JANUARY", monthlySearches: "900" },
              { year: "2025", month: "OCTOBER", monthlySearches: "800" },
              // Unknown month names keep the entry at month 0.
              { year: "2025", month: "SOME_DAY", monthlySearches: "10" },
            ],
          },
        },
      ]),
    );

    const ideas = await generateKeywordIdeas({
      keywords: ["hiking boots"],
      locationCode: 2578,
      languageCode: "en",
    });

    const ideasUrl = fetchMock.mock.calls[1][0];
    expect(typeof ideasUrl === "string" ? ideasUrl : "").toContain("/v26/");
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: "Bearer token",
    });
    expect(requestBody(fetchMock.mock.calls[1])).toEqual({
      keywordSeed: { keywords: ["hiking boots"] },
      pageSize: 100,
      keywordPlanNetwork: "GOOGLE_SEARCH",
      geoTargetConstants: ["geoTargetConstants/2578"],
      historicalMetricsOptions: { includeAverageCpc: true },
    });
    expect(ideas[0]).toEqual({
      keyword: "hiking boots",
      volume: 1000,
      cpc: 1.2345, // micros → currency units, 4 decimals
      competitionEnum: "MEDIUM",
      monthly: [
        { year: 2025, month: 1, searchVolume: 900 },
        { year: 2025, month: 10, searchVolume: 800 },
        { year: 2025, month: 0, searchVolume: 10 },
      ],
    });
  });

  it("keeps cpc null and trend empty when the fields are absent", async () => {
    const fetchMock = stubIdeasFetch(
      ideasResponse([
        {
          text: "hiking boots",
          keywordIdeaMetrics: { avgMonthlySearches: "1000" },
        },
      ]),
    );

    const ideas = await generateKeywordIdeas({
      keywords: ["hiking boots"],
      locationCode: 2578,
      languageCode: "en",
    });

    expect(ideas[0].cpc).toBeNull();
    expect(ideas[0].monthly).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
