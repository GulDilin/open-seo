import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseYandexDocs } from "./xml";
import { yandexProvider } from "./adapter";
import { wordstatProvider } from "./wordstat";
import type { SerpRankCheck } from "@/server/lib/seo-providers/types";

const mocks = vi.hoisted(() => ({
  yandexWebSearch: vi.fn(),
  wordstatTopRequests: vi.fn(),
}));

vi.mock("./client", () => ({
  yandexWebSearch: mocks.yandexWebSearch,
  wordstatTopRequests: mocks.wordstatTopRequests,
}));

// Assembled from the documented YaXML result shape (search > results >
// grouping > group > doc); AT INTEGRATION: re-record from a live key.
const RAW_XML = `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0">
 <response>
  <results>
   <grouping>
    <group>
     <doc>
      <url>https://ozon.ru/category/sneaky/</url>
      <domain>ozon.ru</domain>
      <title>Кроссовки — купить на Ozon</title>
     </doc>
    </group>
    <group>
     <doc>
      <url>https://blog.wildberries.example.com/sneaky-guide</url>
      <domain>blog.wildberries.example.com</domain>
      <title>Как выбрать кроссовки</title>
     </doc>
    </group>
    <group>
     <doc>
      <url>https://lamoda.ru/krossovki</url>
      <domain>lamoda.ru</domain>
      <title>Кроссовки &quot;для бега&quot;</title>
     </doc>
    </group>
   </grouping>
  </results>
 </response>
</yandexsearch>`;

const parsedDocs = parseYandexDocs(RAW_XML);

const baseCheck: SerpRankCheck = {
  keyword: "кроссовки купить",
  engine: "yandex",
  country: "ru",
  language: "ru",
  device: "desktop",
  targetDomain: "wildberries.example.com",
  depth: 100,
};

describe("parseYandexDocs", () => {
  it("extracts url, lowercase domain, and entity-decoded title per doc", () => {
    expect(parsedDocs).toHaveLength(3);
    expect(parsedDocs[0]).toEqual({
      url: "https://ozon.ru/category/sneaky/",
      domain: "ozon.ru",
      title: "Кроссовки — купить на Ozon",
    });
    expect(parsedDocs[2].title).toContain('"для бега"');
  });
});

describe("yandexProvider.checkRank", () => {
  beforeEach(() => {
    mocks.yandexWebSearch.mockResolvedValue(parsedDocs);
  });

  it("matches subdomains with 1-based positions", async () => {
    const result = await yandexProvider.checkRank(baseCheck);
    expect(result.position).toBe(2);
    expect(result.url).toBe(
      "https://blog.wildberries.example.com/sneaky-guide",
    );
    expect(result.topResults[0]).toMatchObject({
      position: 1,
      domain: "ozon.ru",
    });
  });

  it("passes the region id through and reports null when absent", async () => {
    const regional = await yandexProvider.checkRank({
      ...baseCheck,
      region: "213",
    });
    expect(mocks.yandexWebSearch).toHaveBeenCalledWith(
      expect.objectContaining({ region: "213" }),
    );
    expect(regional.position).toBe(2);

    const absent = await yandexProvider.checkRank({
      ...baseCheck,
      targetDomain: "nowhere.example",
    });
    expect(absent.position).toBeNull();
    expect(absent.url).toBeNull();
  });

  it("rejects a non-yandex engine before any call", async () => {
    await expect(
      yandexProvider.checkRank({ ...baseCheck, engine: "google" }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(mocks.yandexWebSearch).not.toHaveBeenCalled();
  });
});

describe("wordstatProvider.getVolumes", () => {
  beforeEach(() => {
    mocks.wordstatTopRequests.mockResolvedValue({
      totalCount: "123456",
      results: [
        { phrase: "кроссовки купить", count: "5400" },
        { phrase: "кроссовки купить недорого", count: "1200" },
      ],
      associations: [],
    });
  });

  it("uses the exact-phrase row, null volume otherwise, no invented metrics", async () => {
    const rows = await wordstatProvider.getVolumes([
      { keyword: "кроссовки купить", country: "ru", language: "ru" },
      { keyword: "несуществующая фраза", country: "ru", language: "ru" },
    ]);

    expect(rows[0]).toEqual({
      keyword: "кроссовки купить",
      volume: 5400,
      cpc: null,
      competition: null,
      difficulty: null,
      source: "wordstat",
    });
    expect(rows[1].volume).toBeNull();
    expect(rows[1].source).toBe("wordstat");
  });

  it("sends numeric region ids and drops non-id region labels", async () => {
    await wordstatProvider.getVolumes([
      { keyword: "кроссовки", country: "ru", language: "ru", region: "213" },
      {
        keyword: "кроссовки",
        country: "ru",
        language: "ru",
        region: "Moscow,Russia", // DataForSEO city label, not a region id
      },
    ]);

    expect(mocks.wordstatTopRequests).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ regions: ["213"] }),
    );
    expect(mocks.wordstatTopRequests).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ regions: undefined }),
    );
  });
});
