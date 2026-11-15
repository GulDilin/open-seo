import { describe, expect, it } from "vitest";
import {
  SEO_PROVIDER_CREDENTIALS,
  SEO_PROVIDER_ENGINES,
  SEO_PROVIDER_IDS,
  SEARCH_ENGINES,
  SERP_PROVIDER_CHAIN,
  enginesForCountry,
  isEngineAvailableForCountry,
  searchEngineField,
} from "./search-engines";

describe("search engines", () => {
  it("keeps chains and provider engine lists in agreement", () => {
    for (const engine of SEARCH_ENGINES) {
      const chain = SERP_PROVIDER_CHAIN[engine];
      // Every chain names at least one known provider that serves the engine.
      expect(chain.length).toBeGreaterThan(0);
      for (const id of chain) {
        expect(SEO_PROVIDER_IDS).toContain(id);
        expect(SEO_PROVIDER_ENGINES[id]).toContain(engine);
      }
    }
    for (const id of SEO_PROVIDER_IDS) {
      // No provider claims an engine no chain routes to it for.
      for (const engine of SEO_PROVIDER_ENGINES[id]) {
        expect(SERP_PROVIDER_CHAIN[engine]).toContain(id);
      }
    }
  });

  it("documents credentials for every provider", () => {
    for (const id of SEO_PROVIDER_IDS) {
      expect(SEO_PROVIDER_CREDENTIALS[id].length).toBeGreaterThan(0);
    }
    // Yandex is the only multi-credential provider: key AND folder id.
    expect(SEO_PROVIDER_CREDENTIALS.yandex).toEqual([
      "YANDEX_SEARCH_API_KEY",
      "YANDEX_FOLDER_ID",
    ]);
  });

  it("offers declared engines per market and defaults others to google", () => {
    expect(enginesForCountry(643)).toEqual(["yandex", "google"]); // Russia — google gated on Serper
    expect(enginesForCountry(156)).toEqual(["baidu"]); // China
    expect(enginesForCountry(2578)).toEqual(["google", "bing"]); // Norway
    expect(enginesForCountry(2840)).toEqual(["google"]); // US
    expect(enginesForCountry(999999)).toEqual(["google"]); // unknown market
    expect(isEngineAvailableForCountry(2840, "google")).toBe(true);
    expect(isEngineAvailableForCountry(2840, "baidu")).toBe(false);
  });

  it("defaults an omitted engine field to google", () => {
    expect(searchEngineField.parse(undefined)).toBe("google");
    expect(searchEngineField.parse("yandex")).toBe("yandex");
  });
});
