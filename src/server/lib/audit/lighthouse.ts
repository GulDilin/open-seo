import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { detectUrlTemplate, canonicalUrlKey } from "./url-utils";
import type { LighthouseResult, LighthouseStrategy } from "./types";
import type { PageFetchClass } from "@/shared/audit-fetch-class";
import { putTextToR2 } from "@/server/lib/r2";
import {
  buildStoredLighthouseIssues,
  buildStoredLighthouseMetrics,
  type RawLighthouseAudit,
  type RawLighthouseCategory,
  type StoredLighthousePayload,
} from "@/server/lib/lighthouseStoredPayload";

interface LighthouseSamplePage {
  url: string;
  statusCode: number;
  fetchClass: PageFetchClass;
}

function canonicalUrlKeyWithoutTrailingSlash(url: string): string {
  const parsed = new URL(canonicalUrlKey(url));
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
  }
  return parsed.toString();
}

type LighthouseFetchResult = {
  result: LighthouseResult;
  payloadJson: string | null;
};

/** A check that produced no payload — provider error, or a failed fetch step. */
export function failedLighthouseFetch(
  url: string,
  pageId: string,
  strategy: "mobile" | "desktop",
  errorMessage: string,
): LighthouseFetchResult {
  return {
    result: {
      url,
      pageId,
      strategy,
      performanceScore: null,
      accessibilityScore: null,
      bestPracticesScore: null,
      seoScore: null,
      lcpMs: null,
      cls: null,
      inpMs: null,
      ttfbMs: null,
      errorMessage,
    },
    payloadJson: null,
  };
}

/**
 * Page vitals via Google PageSpeed Insights — free, same Lighthouse under
 * the hood the incumbent resold (decisions §7). One request per page; a
 * failure isolates to its page and the audit continues.
 *
 * ponytail: keyless PSI is generous per IP; add PAGESPEED_API_KEY env only
 * if a real audit ever hits the free ceiling.
 */
const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

const psiResponseSchema = z
  .object({
    lighthouseResult: z
      .object({
        requestedUrl: z.string().optional(),
        finalUrl: z.string().optional(),
        lighthouseVersion: z.string().optional(),
        // Key maps only (same trick as the DataForSEO reader): the report
        // bodies stay as PSI's own objects instead of being cloned again.
        categories: z
          .record(z.string(), z.custom<RawLighthouseCategory>())
          .optional(),
        audits: z.record(z.string(), z.custom<RawLighthouseAudit>()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

function scoreToPercent(score?: number | null): number | null {
  return score == null ? null : Math.round(score * 100);
}

function auditNumericValue(
  audits: Record<string, unknown> | undefined,
  id: string,
): number | null {
  const audit = audits?.[id];
  if (typeof audit !== "object" || audit === null) return null;
  const value = (audit as { numericValue?: unknown }).numericValue;
  return typeof value === "number" ? value : null;
}

async function psiLighthouse(
  url: string,
  strategy: "mobile" | "desktop",
): Promise<Response> {
  const categories = ["performance", "accessibility", "best-practices", "seo"];
  const params = new URLSearchParams({ url, strategy });
  for (const category of categories) params.append("category", category);
  return fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(60_000),
  });
}

export async function fetchLighthouseResult(
  url: string,
  pageId: string,
  strategy: "mobile" | "desktop",
): Promise<LighthouseFetchResult> {
  try {
    // One retry on 429/5xx/timeout only — the free source has no SLA, and
    // the next audit re-measures anyway. A network error or timeout counts
    // as an attempt (it used to escape the loop unretried) and the thrown
    // error names the real last failure, not a generic "timeout".
    let response: Response | null = null;
    let lastFailure = "request failed";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await psiLighthouse(url, strategy);
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : "request failed";
        continue;
      }
      if (response.ok) break;
      lastFailure = `PSI responded ${response.status}`;
      // Hard failures (4xx, other 5xx-classes) are not retried.
      if (response.status !== 429 && response.status < 500) break;
      response = null;
    }
    if (!response || !response.ok) {
      throw new AppError("UPSTREAM_UNAVAILABLE", lastFailure);
    }
    const parsed = psiResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("PSI response failed schema validation");
    }
    const lr = parsed.data.lighthouseResult;
    const audits = lr.audits ?? {};
    const categories = lr.categories ?? {};
    // Stored in R2 as the same normalized payload shape the DataForSEO path
    // writes, so readStoredLighthousePayload serves both sources unchanged.
    const issueReport = buildStoredLighthouseIssues({ audits, categories });
    const storedPayload: StoredLighthousePayload = {
      version: 2,
      source: "psi-lighthouse",
      hasIssueDetails: issueReport.hasIssueDetails,
      metadata: {
        requestedUrl: lr.requestedUrl ?? url,
        finalUrl: lr.finalUrl ?? url,
        strategy,
        fetchedAt: new Date().toISOString(),
        lighthouseVersion: lr.lighthouseVersion ?? null,
        taskId: null,
        cost: null,
      },
      scores: {
        performance: scoreToPercent(categories.performance?.score),
        accessibility: scoreToPercent(categories.accessibility?.score),
        "best-practices": scoreToPercent(categories["best-practices"]?.score),
        seo: scoreToPercent(categories.seo?.score),
      },
      metrics: buildStoredLighthouseMetrics({ audits }),
      issues: issueReport.issues,
    };

    return {
      result: {
        url,
        pageId,
        strategy,
        performanceScore: storedPayload.scores.performance,
        accessibilityScore: storedPayload.scores.accessibility,
        bestPracticesScore: storedPayload.scores["best-practices"],
        seoScore: storedPayload.scores.seo,
        lcpMs: auditNumericValue(audits, "largest-contentful-paint"),
        cls: auditNumericValue(audits, "cumulative-layout-shift"),
        inpMs: auditNumericValue(audits, "interaction-to-next-paint"),
        ttfbMs: auditNumericValue(audits, "server-response-time"),
      },
      payloadJson: JSON.stringify(storedPayload),
    };
  } catch (error) {
    const failed = error instanceof Error ? error : new Error(String(error));
    // Page-level failures (timeouts, PSI's own error payloads) are isolated:
    // the audit keeps going and the row shows the reason.
    console.warn(
      `Lighthouse failed for ${url} (${strategy}): ${failed.message}`,
    );
    return failedLighthouseFetch(url, pageId, strategy, failed.message);
  }
}

export async function storeLighthouseResult(input: {
  projectId: string;
  auditId: string;
  fetched: LighthouseFetchResult;
}): Promise<LighthouseResult> {
  if (!input.fetched.payloadJson) {
    return input.fetched.result;
  }

  const { pageId, strategy } = input.fetched.result;
  const key = `site-audit/${input.projectId}/${input.auditId}/${pageId}-${strategy}.json`;
  const uploaded = await putTextToR2(key, input.fetched.payloadJson);

  return {
    ...input.fetched.result,
    r2Key: uploaded.key,
    payloadSizeBytes: uploaded.sizeBytes,
  };
}

/**
 * Select which pages to run Lighthouse on, based on the chosen strategy.
 */
export function selectLighthouseSample(
  pages: LighthouseSamplePage[],
  startUrl: string,
  strategy: LighthouseStrategy,
): string[] {
  if (strategy === "none") return [];

  // Only consider pages that loaded successfully. A bot challenge can answer
  // 200, and a paid Lighthouse check of it measures the challenge.
  const validPages = pages.filter(
    (p) => p.statusCode >= 200 && p.statusCode < 300 && p.fetchClass === "ok",
  );

  // strategy === "auto": homepage + 1 per URL pattern, capped at 10
  const selected = new Set<string>();

  // Always include the start URL / homepage. Prefer an exact canonical match
  // so distinct 2xx `/path` and `/path/` pages stay distinct, then tolerate a
  // trailing-slash redirect when the exact start URL was not crawled as 2xx.
  const startKey = canonicalUrlKey(startUrl);
  const startPage =
    validPages.find((p) => canonicalUrlKey(p.url) === startKey) ??
    validPages.find(
      (p) =>
        canonicalUrlKeyWithoutTrailingSlash(p.url) ===
        canonicalUrlKeyWithoutTrailingSlash(startUrl),
    );
  if (startPage) selected.add(startPage.url);

  // Group by URL template pattern
  const templateGroups = new Map<string, LighthouseSamplePage>();
  if (startPage) {
    templateGroups.set(
      detectUrlTemplate(new URL(startPage.url).pathname),
      startPage,
    );
  }
  for (const page of validPages) {
    if (selected.has(page.url)) continue;
    const template = detectUrlTemplate(new URL(page.url).pathname);
    if (!templateGroups.has(template)) {
      templateGroups.set(template, page);
    }
  }

  // Add one page per template group
  for (const [, page] of templateGroups) {
    if (selected.size >= 10) break;
    selected.add(page.url);
  }

  return Array.from(selected);
}
