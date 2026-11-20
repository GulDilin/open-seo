import { describe, expect, it } from "vitest";
import type { YandexQueryRow } from "@/server/lib/yandexWebmasterClient";
import {
  sumYandexPreviousTotals,
  sumYandexQueryTotals,
} from "@/server/features/yandex/yandexSearchQueries";

const row = (overrides: Partial<YandexQueryRow>): YandexQueryRow => ({
  queryId: overrides.query ?? "q1",
  query: overrides.query ?? "q1",
  impressions: null,
  clicks: null,
  avgShowPosition: null,
  avgClickPosition: null,
  ...overrides,
});

describe("sumYandexQueryTotals", () => {
  it("sums clicks/impressions, derives CTR, and impression-weights position", () => {
    const totals = sumYandexQueryTotals([
      row({ query: "a", impressions: 100, clicks: 10, avgShowPosition: 2 }),
      row({ query: "b", impressions: 300, clicks: 5, avgShowPosition: 10 }),
    ]);
    expect(totals.clicks).toBe(15);
    expect(totals.impressions).toBe(400);
    expect(totals.ctr).toBeCloseTo(15 / 400);
    // (2*100 + 10*300) / 400 = 8 — the same construction GSC uses.
    expect(totals.position).toBeCloseTo(8);
  });

  it("treats null indicators as zero and skips them from position weights", () => {
    const totals = sumYandexQueryTotals([
      // Position undefined: still counts toward clicks/impressions/CTR.
      row({ query: "a", impressions: 100, clicks: 4 }),
      // Zero-click query (Yandex returns nulls, e.g. AVG_CLICK_POSITION).
      row({ query: "b", impressions: 50, clicks: null, avgShowPosition: 5 }),
    ]);
    expect(totals.clicks).toBe(4);
    expect(totals.impressions).toBe(150);
    expect(totals.ctr).toBeCloseTo(4 / 150);
    // Only query b has a position: weighted over its 50 impressions alone.
    expect(totals.position).toBe(5);
  });

  it("returns null CTR and position when nothing can be computed", () => {
    expect(sumYandexQueryTotals([])).toEqual({
      clicks: 0,
      impressions: 0,
      ctr: null,
      position: null,
    });
    expect(sumYandexQueryTotals([row({ query: "a" })]).ctr).toBeNull();
  });
});

describe("sumYandexPreviousTotals", () => {
  it("sums the previous window only over the current query set", () => {
    const current = [
      row({ query: "a", impressions: 100, clicks: 10 }),
      row({ query: "b", impressions: 50, clicks: 5 }),
    ];
    const previous = [
      row({ query: "a", impressions: 80, clicks: 2, avgShowPosition: 4 }),
      // Not in the current top — excluded from the comparison entirely.
      row({ query: "gone", impressions: 900, clicks: 900 }),
    ];
    const { totals, matchedQueryCount } = sumYandexPreviousTotals(
      current,
      previous,
    );
    expect(matchedQueryCount).toBe(1);
    expect(totals.clicks).toBe(2);
    expect(totals.impressions).toBe(80);
    expect(totals.position).toBe(4);
  });

  it("counts unmatched current queries as zero, not as missing data", () => {
    const { totals, matchedQueryCount } = sumYandexPreviousTotals(
      [row({ query: "a", clicks: 10, impressions: 10 }), row({ query: "new" })],
      [row({ query: "a", clicks: 4, impressions: 10 })],
    );
    expect(matchedQueryCount).toBe(1);
    expect(totals.clicks).toBe(4);
  });
});
