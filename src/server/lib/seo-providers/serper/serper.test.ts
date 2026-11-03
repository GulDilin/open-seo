import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import fixture from "./fixtures/serper-response.json";
import { mapSerperResponse, serperProvider } from "./adapter";
import { serperSearch } from "./client";
import type { SerpRankCheck } from "@/server/lib/seo-providers/types";

const envMocks = vi.hoisted(() => ({
  getRequiredEnvValue: vi.fn(),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: envMocks.getRequiredEnvValue,
}));

const baseCheck: SerpRankCheck = {
  keyword: "buy running shoes",
  engine: "google",
  country: "us",
  language: "en",
  device: "desktop",
  targetDomain: "runnersworld.com",
  depth: 100,
};

describe("mapSerperResponse", () => {
  it("finds the target domain among organic results", () => {
    const result = mapSerperResponse(baseCheck, fixture);
    expect(result.position).toBe(2);
    expect(result.url).toBe("https://www.runnersworld.com/best-running-shoes");
    expect(result.topResults).toHaveLength(5);
    expect(result.topResults[0]).toMatchObject({
      position: 1,
      domain: "nike.com",
    });
  });

  it("counts subdomains of the target as the target", () => {
    const result = mapSerperResponse(
      { ...baseCheck, targetDomain: "shoehub.example.com" },
      fixture,
    );
    // store.shoehub.example.com ranks 4th.
    expect(result.position).toBe(4);
  });

  it("reports not-ranking when the domain is absent", () => {
    const result = mapSerperResponse(
      { ...baseCheck, targetDomain: "nowhere.example" },
      fixture,
    );
    expect(result.position).toBeNull();
    expect(result.url).toBeNull();
  });

  it("falls back to array order when positions are omitted", () => {
    const response = {
      organic: fixture.organic.map(({ position: _position, ...item }) => item),
    };
    const result = mapSerperResponse(baseCheck, response);
    expect(result.position).toBe(2);
    expect(result.topResults.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("serperProvider.checkRank", () => {
  it("rejects a non-google engine before any network call", async () => {
    await expect(
      serperProvider.checkRank({ ...baseCheck, engine: "baidu" }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("rejects city-level checks instead of reporting national numbers", async () => {
    await expect(
      serperProvider.checkRank({ ...baseCheck, region: "Enid,Oklahoma" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

function serperPageResponse(links: string[]) {
  return new Response(
    JSON.stringify({
      organic: links.map((link, index) => ({
        title: `Result ${index + 1}`,
        link,
        snippet: "snippet",
        // Serper positions are page-relative (1..10 within the page).
        position: index + 1,
      })),
    }),
    { status: 200 },
  );
}

/** Serialized JSON body of a fetch call (our clients post string bodies). */
function jsonBodyOf(call: Parameters<typeof fetch>): unknown {
  const body = call[1]?.body;
  return JSON.parse(typeof body === "string" ? body : "null");
}

/** Parsed request bodies of the POSTs serperSearch issued, oldest first. */
function postedBodies(fetchMock: Mock<typeof fetch>): unknown[] {
  return fetchMock.mock.calls.map((call): unknown => jsonBodyOf(call));
}

describe("serperSearch pagination", () => {
  beforeEach(() => {
    envMocks.getRequiredEnvValue.mockResolvedValue("test-key");
  });

  it("stops after the page where the target domain ranks", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        serperPageResponse([
          "https://a.example/1",
          "https://b.example/2",
          "https://c.example/3",
        ]),
      )
      .mockResolvedValueOnce(
        serperPageResponse([
          "https://d.example/4",
          "https://target.example/5",
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await serperSearch({
      keyword: "shoes",
      country: "us",
      language: "en",
      depth: 100, // up to 10 pages
      stopDomain: "target.example",
    });
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(postedBodies(fetchMock)).toMatchObject([
      { num: 10, page: 1 },
      { num: 10, page: 2 },
    ]);
    // Cross-page positions: page 2 continues after page 1's results.
    expect(response.organic.map((item) => item.position)).toEqual([
      1, 2, 3, 11, 12,
    ]);
  });

  it("makes a single request when the domain ranks on the first page", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      serperPageResponse(["https://a.example/1", "https://target.example/2"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await serperSearch({
      keyword: "shoes",
      country: "us",
      language: "en",
      depth: 100,
      stopDomain: "target.example",
    });
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("walks only ceil(depth/10) pages when the domain never ranks", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        serperPageResponse([
          "https://a.example/1",
          "https://b.example/2",
          "https://c.example/3",
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await serperSearch({
      keyword: "shoes",
      country: "us",
      language: "en",
      depth: 25, // 3 pages of 10
      stopDomain: "nowhere.example",
    });
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.organic).toHaveLength(9);
    expect(response.organic.map((item) => item.position)).toEqual([
      1, 2, 3, 11, 12, 13, 21, 22, 23,
    ]);
  });
});
