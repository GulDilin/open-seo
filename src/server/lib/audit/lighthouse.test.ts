import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/r2", () => ({
  putTextToR2: vi.fn(),
}));

import { fetchLighthouseResult, selectLighthouseSample } from "./lighthouse";
import { storedLighthousePayloadSchema } from "@/server/lib/lighthouseStoredPayload";

const okPage = (url: string) => ({
  url,
  statusCode: 200,
  fetchClass: "ok" as const,
});

describe("selectLighthouseSample", () => {
  it("does not spend checks on a bot challenge that answered 200", () => {
    const selected = selectLighthouseSample(
      [
        { ...okPage("https://example.com/"), fetchClass: "blocked" },
        okPage("https://example.com/about"),
      ],
      "https://example.com/",
      "auto",
    );

    expect(selected).toEqual(["https://example.com/about"]);
  });

  it("includes a start page reached through a trailing-slash redirect", () => {
    const pages = [
      ...Array.from({ length: 10 }, (_, index) =>
        okPage(`https://example.com/section${index}`),
      ),
      okPage("https://example.com/services/"),
    ];

    const selected = selectLighthouseSample(
      pages,
      "https://example.com/services",
      "auto",
    );

    expect(selected).toHaveLength(10);
    expect(selected[0]).toBe("https://example.com/services/");
  });

  it("prefers an exact start page when both slash forms return 2xx", () => {
    const selected = selectLighthouseSample(
      [
        okPage("https://example.com/services/"),
        okPage("https://example.com/services"),
      ],
      "https://example.com/services",
      "auto",
    );

    expect(selected[0]).toBe("https://example.com/services");
  });

  it("does not sample another page from the start page's template", () => {
    const selected = selectLighthouseSample(
      [
        okPage("https://example.com/products/123"),
        okPage("https://example.com/products/456"),
        okPage("https://example.com/about"),
      ],
      "https://example.com/products/123",
      "auto",
    );

    expect(selected).toEqual([
      "https://example.com/products/123",
      "https://example.com/about",
    ]);
  });
});

function psiResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchLighthouseResult (PSI)", () => {
  const psiPayload = {
    lighthouseResult: {
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      lighthouseVersion: "12.4.0",
      categories: {
        performance: {
          score: 0.9,
          auditRefs: [{ id: "unused-javascript" }],
        },
        accessibility: {
          score: 0.91,
          auditRefs: [{ id: "color-contrast" }],
        },
        "best-practices": { score: 0.92 },
        seo: { score: 0.93 },
      },
      audits: {
        "largest-contentful-paint": { numericValue: 2400 },
        "cumulative-layout-shift": { numericValue: 0.02 },
        "interaction-to-next-paint": { numericValue: 150 },
        "server-response-time": { numericValue: 300 },
        "unused-javascript": {
          title: "Reduce unused JavaScript",
          description: "Remove unused JavaScript to reduce bytes consumption.",
          score: 0.5,
          scoreDisplayMode: "binary",
          numericValue: 1200,
          details: {
            overallSavingsMs: 400,
            overallSavingsBytes: 90_000,
            items: [{ url: "https://example.com/app.js", wastedBytes: 90_000 }],
          },
        },
        "color-contrast": {
          title: "Insufficient color contrast",
          description: "Fix the contrast ratio.",
          score: 0,
          scoreDisplayMode: "binary",
          displayValue: "2 elements",
          details: { items: [{ nodeLabel: "footer link" }] },
        },
      },
    },
  };

  it("maps the four scores (0..1 to percent) and the field metrics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(psiResponse(psiPayload));
    vi.stubGlobal("fetch", fetchMock);

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "desktop",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetched.result).toMatchObject({
      performanceScore: 90,
      accessibilityScore: 91,
      bestPracticesScore: 92,
      seoScore: 93,
      lcpMs: 2400,
      cls: 0.02,
      inpMs: 150,
      ttfbMs: 300,
    });
    expect(fetched.result.errorMessage).toBeUndefined();

    // R2 gets the normalized stored payload, not PSI's raw JSON — the reader
    // (readStoredLighthousePayload) must be able to serve the issues panel.
    const stored = storedLighthousePayloadSchema.parse(
      JSON.parse(fetched.payloadJson!),
    );
    expect(stored.source).toBe("psi-lighthouse");
    expect(stored.metadata).toMatchObject({
      strategy: "desktop",
      taskId: null,
      cost: null,
    });
    expect(stored.metrics.largestContentfulPaint.numericValue).toBe(2400);
    expect(stored.issues).toHaveLength(2);
    expect(stored.issues).toContainEqual(
      expect.objectContaining({
        auditKey: "unused-javascript",
        category: "performance",
        severity: "critical",
        impactMs: 400,
      }),
    );
    expect(stored.issues).toContainEqual(
      expect.objectContaining({ auditKey: "color-contrast", score: 0 }),
    );
    vi.unstubAllGlobals();
  });

  it("retries a 500 once, then isolates the failure to the page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(psiResponse({}, 500))
      .mockResolvedValueOnce(psiResponse(psiPayload));
    vi.stubGlobal("fetch", fetchMock);

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "mobile",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetched.result.performanceScore).toBe(90);
    vi.unstubAllGlobals();
  });

  it("retries a timeout once, then isolates the failure to the page", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("The operation was aborted due to timeout"),
      )
      .mockResolvedValueOnce(psiResponse(psiPayload));
    vi.stubGlobal("fetch", fetchMock);

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "mobile",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetched.result.performanceScore).toBe(90);
    vi.unstubAllGlobals();
  });

  it("names the 429 after exhausting the retry instead of calling it a timeout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(psiResponse({}, 429));
    vi.stubGlobal("fetch", fetchMock);

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "desktop",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetched.result.errorMessage).toContain("429");
    vi.unstubAllGlobals();
  });

  it("records the failure without retrying a hard 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(psiResponse({}, 400));
    vi.stubGlobal("fetch", fetchMock);

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "desktop",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetched.result.errorMessage).toContain("400");
    expect(fetched.payloadJson).toBeNull();
    vi.unstubAllGlobals();
  });
});
