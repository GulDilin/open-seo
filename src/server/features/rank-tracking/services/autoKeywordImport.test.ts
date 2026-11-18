import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_IMPORT_KEYWORDS_PER_CONFIG } from "@/shared/rank-tracking";
import { syncAutoImportedKeywords } from "./autoKeywordImport";
import { PanelKeywordSuggestions } from "./panelKeywordSuggestions";
import { RankTrackingKeywordService } from "./RankTrackingKeywordService";

vi.mock("./panelKeywordSuggestions", () => ({
  PanelKeywordSuggestions: { get: vi.fn() },
}));

vi.mock("./RankTrackingKeywordService", () => ({
  RankTrackingKeywordService: { addKeywords: vi.fn() },
}));

const googleConfig = {
  id: "cfg_google",
  projectId: "proj_1",
  domain: "site.example",
  searchEngine: "google",
} as const;
const yandexConfig = {
  id: "cfg_yandex",
  projectId: "proj_1",
  domain: "site.example",
  searchEngine: "yandex",
} as const;

function suggestion(query: string, source: "gsc" | "yandex_webmaster") {
  return { query, source, impressions: 10, clicks: 1, position: 5 };
}

const addKeywords = vi.mocked(RankTrackingKeywordService.addKeywords);
const panelGet = vi.mocked(PanelKeywordSuggestions.get);

beforeEach(() => {
  panelGet.mockResolvedValue({ suggestions: [], sources: [] });
  addKeywords.mockResolvedValue({
    added: 1,
    addedIds: ["kw_1"],
    scheduledEstimate: undefined,
  });
});

describe("syncAutoImportedKeywords", () => {
  it("fetches each panel per source and routes queries only to that source's engines", async () => {
    panelGet.mockImplementation(async (input) =>
      input.source === "gsc"
        ? {
            sources: ["gsc"],
            suggestions: [suggestion("google query", "gsc")],
          }
        : {
            sources: ["yandex_webmaster"],
            suggestions: [suggestion("yandex query", "yandex_webmaster")],
          },
    );

    await syncAutoImportedKeywords([googleConfig, yandexConfig]);

    // One fetch per source for the shared (projectId, domain) key.
    expect(panelGet).toHaveBeenCalledTimes(2);
    expect(panelGet.mock.calls.map((call) => call[0].source)).toEqual(
      expect.arrayContaining(["gsc", "yandex_webmaster"]),
    );
    // Domain-scoped subtraction so another domain's tracker can't block.
    for (const call of panelGet.mock.calls) {
      expect(call[0].subtract).toBe("domain");
    }
    const calls = Object.fromEntries(
      addKeywords.mock.calls.map((call) => [call[0], call[2]]),
    );
    expect(calls.cfg_google).toEqual(["google query"]);
    expect(calls.cfg_yandex).toEqual(["yandex query"]);
  });

  it("skips the panel no config of the key can consume", async () => {
    panelGet.mockResolvedValue({
      sources: ["yandex_webmaster"],
      suggestions: [suggestion("q", "yandex_webmaster")],
    });

    await syncAutoImportedKeywords([yandexConfig]);

    // A yandex-only key asks only the Yandex panel, never GSC.
    expect(panelGet).toHaveBeenCalledTimes(1);
    expect(panelGet.mock.calls[0][0].source).toBe("yandex_webmaster");
  });

  it("caps imported keywords per config and asks the panel for the same cap", async () => {
    panelGet.mockResolvedValue({
      sources: ["gsc"],
      suggestions: Array.from({ length: 400 }, (_, i) =>
        suggestion(`query ${i}`, "gsc"),
      ),
    });

    await syncAutoImportedKeywords([googleConfig]);

    expect(addKeywords.mock.calls[0][2]).toHaveLength(
      AUTO_IMPORT_KEYWORDS_PER_CONFIG,
    );
    expect(panelGet.mock.calls[0][0].limit).toBe(
      AUTO_IMPORT_KEYWORDS_PER_CONFIG,
    );
  });

  it("caps distinct (projectId, domain) keys per call so overflow syncs later", async () => {
    const configs = [1, 2, 3].map((n) => ({
      ...googleConfig,
      id: `cfg_${n}`,
      domain: `site${n}.example`,
    }));

    await syncAutoImportedKeywords(configs, 2);

    expect(panelGet).toHaveBeenCalledTimes(2);
  });

  it("one config's failure does not block its siblings", async () => {
    panelGet.mockResolvedValue({
      sources: ["gsc"],
      suggestions: [suggestion("q", "gsc")],
    });
    addKeywords
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({
        added: 1,
        addedIds: ["kw_2"],
        scheduledEstimate: undefined,
      });

    const added = await syncAutoImportedKeywords([
      googleConfig,
      { ...googleConfig, id: "cfg_google_2" },
    ]);

    expect(addKeywords).toHaveBeenCalledTimes(2);
    expect(added).toBe(1);
  });
});
