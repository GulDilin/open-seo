import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { getRequiredEnvValue } from "@/server/lib/runtime-env";
import { hostOf, matchesTargetDomain } from "../domain-match";

/**
 * Serper (google.serper.dev) HTTP client. Google removed num=100 in
 * September 2025: one request returns ~10 organic results, and asking for
 * more than 20 double-bills. Depth is therefore collected page by page
 * (num=10, one base-plan credit per page), and pagination stops as soon as
 * stopDomain shows up on a page — we only pay for pages up to the find (the
 * Serper analogue of DataForSEO's stop_crawl_on_match). Wire format is
 * validated here and never leaves this module (constitution: Provider
 * Normalization at the Boundary).
 *
 * ponytail: Serper has no device parameter — the API serves Google's desktop
 * layout, so mobile-device tracker checks record desktop positions under the
 * Serper path. Revisit only if Serper ships a device flag.
 */

const RESULTS_PER_PAGE = 10;

const serperOrganicItemSchema = z.object({
  // Optional in Serper's response; positions are recomputed across pages.
  position: z.number().int().positive().optional(),
  link: z.string(),
  title: z.string().default(""),
  snippet: z.string().optional(),
});

const serperResponseSchema = z
  .object({
    organic: z.array(serperOrganicItemSchema).default([]),
  })
  .passthrough();

export type SerperResponse = z.infer<typeof serperResponseSchema>;

const SERPER_TIMEOUT_MS = 30_000;

async function serperFetch(body: unknown): Promise<Response> {
  const apiKey = await getRequiredEnvValue("SERPER_API_KEY");
  return fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
  });
}

// One retry on 429/5xx/timeout — paid calls must not retry aggressively
// (same policy as the incumbent's non-idempotent POSTs in dataforseo/core).
// A page that still fails after its retry fails the whole search: a partial
// page list would misreport positions.
async function serperPage(body: unknown): Promise<SerperResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await serperFetch(body);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Serper responded ${response.status}`,
      );
      continue;
    }
    if (!response.ok) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Serper responded ${response.status}`,
      );
    }
    const json: unknown = await response.json();
    const parsed = serperResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Shape drift is treated like a 5xx: one retry, never a partial rank.
      lastError = new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Serper response failed schema validation",
      );
      continue;
    }
    return parsed.data;
  }
  throw lastError instanceof Error
    ? lastError
    : new AppError("UPSTREAM_UNAVAILABLE", "Serper request failed");
}

export async function serperSearch(input: {
  keyword: string;
  country: string; // ISO 3166-1 alpha-2 (Serper `gl`)
  language: string; // ISO 639-1 (Serper `hl`)
  /** How deep to go; every 10-result page costs one credit. */
  depth: number;
  /** Stop paginating once this domain (or a subdomain) ranks on a page. */
  stopDomain?: string;
}): Promise<SerperResponse> {
  const maxPages = Math.max(1, Math.ceil(input.depth / RESULTS_PER_PAGE));
  const stopTarget = input.stopDomain?.toLowerCase();
  const organic: SerperResponse["organic"] = [];
  for (let page = 1; page <= maxPages; page++) {
    const parsed = await serperPage({
      q: input.keyword,
      gl: input.country,
      hl: input.language,
      num: RESULTS_PER_PAGE,
      page,
    });
    if (parsed.organic.length === 0) break; // SERP exhausted — stop paying
    organic.push(
      ...parsed.organic.map((item, index) => ({
        ...item,
        // Serper's per-page `position` is relative to that page, so offset it
        // into a cross-page rank; array order is the fallback.
        position:
          (page - 1) * RESULTS_PER_PAGE + (item.position ?? index + 1),
      })),
    );
    if (
      stopTarget &&
      parsed.organic.some((item) =>
        matchesTargetDomain(hostOf(item.link), stopTarget),
      )
    ) {
      break;
    }
  }
  return { organic };
}
