import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { z } from "zod";
import { brightDataProvider } from "./adapter";

const envMocks = vi.hoisted(() => ({
  getRequiredEnvValue: vi.fn(),
  getOptionalEnvValue: vi.fn(),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: envMocks.getRequiredEnvValue,
  getOptionalEnvValue: envMocks.getOptionalEnvValue,
}));

const baseCheck = {
  keyword: "运动鞋",
  engine: "baidu" as const,
  country: "cn",
  language: "zh-CN",
  device: "desktop" as const,
  targetDomain: "example.cn",
  depth: 100,
};

function bdResponse(
  organic: Array<{ link: string; title?: string }>,
): Response {
  // Full parsed JSON (format:"json"): organic with global_rank positions.
  return new Response(
    JSON.stringify({
      organic: organic.map((item, index) => ({
        link: item.link,
        title: item.title ?? "",
        description: "desc",
        global_rank: index + 1,
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

const requestBodySchema = z.object({ url: z.string() });

/** Target URLs of the requests brightDataSearch issued, oldest first. */
function requestedUrls(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls.map((call): string => {
    const body = requestBodySchema.safeParse(jsonBodyOf(call));
    return body.success ? body.data.url : "";
  });
}

/** Rank-less organic — exercises the cross-page fallback positions. */
function bdOrganicResponse(links: string[]): Response {
  return new Response(
    JSON.stringify({
      organic: links.map((link) => ({ link, title: "t" })),
    }),
    { status: 200 },
  );
}

describe("brightDataProvider.checkRank", () => {
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    envMocks.getRequiredEnvValue.mockResolvedValue("token");
    envMocks.getOptionalEnvValue.mockResolvedValue(undefined);
    fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      bdResponse([
        { link: "https://www.baidu.com/s?wd=%E9%9E%8B", title: "百度搜索" },
        { link: "https://shop.example.cn/shoes", title: "运动鞋商城" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("matches subdomains for baidu with parsed positions", async () => {
    const result = await brightDataProvider.checkRank(baseCheck);
    expect(result.position).toBe(2);
    expect(result.url).toBe("https://shop.example.cn/shoes");
    expect(requestedUrls(fetchMock)[0]).toContain("baidu.com/s");
  });

  it("serves bing through the same adapter", async () => {
    await brightDataProvider.checkRank({ ...baseCheck, engine: "bing" });
    expect(requestedUrls(fetchMock)[0]).toContain("bing.com/search");
  });

  it("rejects other engines before any network call", async () => {
    await expect(
      brightDataProvider.checkRank({ ...baseCheck, engine: "google" }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports null for an absent domain", async () => {
    const result = await brightDataProvider.checkRank({
      ...baseCheck,
      targetDomain: "nowhere.example",
    });
    expect(result.position).toBeNull();
  });

  it("paginates bing via first until the target ranks, deduping overlap", async () => {
    const pages = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(bdOrganicResponse(["https://a.example/1"]))
      .mockResolvedValueOnce(
        bdOrganicResponse([
          // Bing pages may overlap — this page-1 link must not come back.
          "https://a.example/1",
          "https://shop.example.cn/shoes",
        ]),
      );
    vi.stubGlobal("fetch", pages);

    const result = await brightDataProvider.checkRank({
      ...baseCheck,
      engine: "bing",
    });
    vi.unstubAllGlobals();

    expect(pages).toHaveBeenCalledTimes(2);
    expect(requestedUrls(pages)).toEqual([
      expect.stringContaining("first=1"),
      expect.stringContaining("first=11"),
    ]);
    expect(result.position).toBe(11);
    expect(result.topResults).toHaveLength(2);
  });

  it("stops after the first bing page when the domain ranks there", async () => {
    const pages = vi.fn<typeof fetch>().mockResolvedValue(
      bdResponse([
        { link: "https://a.example/1" },
        { link: "https://shop.example.cn/shoes" },
      ]),
    );
    vi.stubGlobal("fetch", pages);

    await brightDataProvider.checkRank({ ...baseCheck, engine: "bing" });
    vi.unstubAllGlobals();

    expect(pages).toHaveBeenCalledOnce();
  });

  it("keeps baidu at a single request — no documented pagination", async () => {
    const result = await brightDataProvider.checkRank({
      ...baseCheck,
      targetDomain: "nowhere.example",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    // One page is the ceiling; topResults just holds fewer rows than depth.
    expect(result.topResults).toHaveLength(2);
  });
});
