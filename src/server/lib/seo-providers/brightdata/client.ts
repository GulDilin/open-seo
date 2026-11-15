import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  getOptionalEnvValue,
  getRequiredEnvValue,
} from "@/server/lib/runtime-env";
import { hostOf, matchesTargetDomain } from "../domain-match";

/**
 * Bright Data SERP API client. Facts pinned from the official docs (Oct 2026):
 * - POST https://api.brightdata.com/request, Authorization: Bearer token,
 *   body { zone, url, format } — the engine is selected by the TARGET URL
 *   (bing.com/search, baidu.com/s), not a search_engine field.
 * - format:"json" is the full parsed JSON (organic[]); the parsed_light
 *   variant is capped at the top-10 organic results, so it is not used here.
 * - Bing paginates with `first` (1-based result offset: first=11 → second
 *   page; `count` was deprecated by Bing). Documented pages may overlap, so
 *   items are deduped by link. Pagination stops once stopDomain shows up on
 *   a page — only pages up to the find are billed.
 * - Baidu has no documented pagination parameter: one request, whose organic
 *   list is the ceiling for that check. AT INTEGRATION: the parsed schema
 *   for Baidu is not documented field-by-field; re-verify with a live token.
 *
 * ponytail: sync single-shot /request calls only (the async serp/req +
 * response_id polling path exists but adds a poller for the same data);
 * AT INTEGRATION: confirm the zone name default with a live token.
 */

const RESULTS_PER_PAGE = 10;

const organicItemSchema = z.object({
  global_rank: z.number().int().positive().optional(),
  title: z.string().optional(),
  link: z.string(),
  description: z.string().optional(),
});

const parsedResponseSchema = z
  .object({
    organic: z.array(organicItemSchema).default([]),
  })
  .passthrough();

type BrightDataOrganicItem = {
  position: number;
  domain: string;
  url: string;
  title: string;
};

function engineUrl(
  engine: "baidu" | "bing",
  input: {
    keyword: string;
    country: string;
    language: string;
  },
  page: number,
): string {
  const q = encodeURIComponent(input.keyword);
  if (engine === "baidu") {
    return `https://www.baidu.com/s?wd=${q}`;
  }
  // Bing honours mkt (language-COUNTRY market) with cc as a fallback hint;
  // `first` is the 1-based offset of the first result to return.
  const first = (page - 1) * RESULTS_PER_PAGE + 1;
  return `https://www.bing.com/search?q=${q}&mkt=${input.language}-${input.country.toUpperCase()}&cc=${input.country}&first=${first}`;
}

async function brightDataPage(
  token: string,
  body: Record<string, unknown>,
): Promise<z.infer<typeof parsedResponseSchema>> {
  let response: Response;
  try {
    response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Bright Data request failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Bright Data responded ${response.status}`,
    );
  }
  const json: unknown = await response.json();
  const parsed = parsedResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Bright Data response failed schema validation",
    );
  }
  return parsed.data;
}

export async function brightDataSearch(input: {
  engine: "baidu" | "bing";
  keyword: string;
  country: string; // ISO 3166-1 alpha-2
  language: string; // ISO 639-1
  /** How deep to go; every 10-result page is a billed request. */
  depth: number;
  /** Stop paginating once this domain (or a subdomain) ranks on a page. */
  stopDomain?: string;
}): Promise<BrightDataOrganicItem[]> {
  const token = await getRequiredEnvValue("BRIGHTDATA_API_TOKEN");
  const zone = (await getOptionalEnvValue("BRIGHTDATA_SERP_ZONE")) ?? "serp";
  const stopTarget = input.stopDomain?.toLowerCase();
  // Bing walks pages via `first`; Baidu has no pagination parameter, so one
  // request is its ceiling however deep the tracker wants to go.
  const maxPages =
    input.engine === "bing"
      ? Math.max(1, Math.ceil(input.depth / RESULTS_PER_PAGE))
      : 1;
  const items: BrightDataOrganicItem[] = [];
  const seenLinks = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const parsed = await brightDataPage(token, {
      zone,
      url: engineUrl(input.engine, input, page),
      format: "json",
    });
    if (parsed.organic.length === 0) break; // SERP exhausted — stop paying
    let newOnPage = 0;
    for (const item of parsed.organic) {
      if (seenLinks.has(item.link)) continue; // Bing pages may overlap
      seenLinks.add(item.link);
      items.push({
        position:
          item.global_rank ?? (page - 1) * RESULTS_PER_PAGE + newOnPage + 1,
        domain: hostOf(item.link),
        url: item.link,
        title: item.title ?? "",
      });
      newOnPage++;
    }
    if (
      stopTarget &&
      parsed.organic.some((item) =>
        matchesTargetDomain(hostOf(item.link), stopTarget),
      )
    ) {
      break;
    }
  }
  return items;
}
