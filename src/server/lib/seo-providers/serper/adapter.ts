import { AppError } from "@/server/lib/errors";
import type {
  SerpProvider,
  SerpRankCheck,
  SerpRankResult,
} from "@/server/lib/seo-providers/types";
import { hostOf, matchesTargetDomain } from "../domain-match";
import { serperSearch, type SerperResponse } from "./client";

export function mapSerperResponse(
  input: SerpRankCheck,
  response: SerperResponse,
): SerpRankResult {
  const mapped = response.organic.map((item, index) => ({
    position: item.position ?? index + 1,
    domain: hostOf(item.link),
    url: item.link,
    title: item.title,
  }));
  const target = input.targetDomain.toLowerCase();
  // Organic-only matching, subdomains count — same rule as
  // buildRankCheckResult, so cross-provider history stays comparable.
  const match = mapped.find((item) => matchesTargetDomain(item.domain, target));
  return {
    position: match?.position ?? null,
    url: match?.url ?? null,
    topResults: mapped.slice(0, input.depth),
  };
}

export const serperProvider: SerpProvider = {
  id: "serper",
  engines: ["google"],
  async checkRank(input: SerpRankCheck): Promise<SerpRankResult> {
    if (input.engine !== "google") {
      throw new AppError(
        "INTERNAL_ERROR",
        `serper provider cannot serve engine "${input.engine}"`,
      );
    }
    if (input.region) {
      // City-level Google trackers stay on the DataForSEO path (Serper has no
      // sub-country geo parameter); fail loudly rather than report national
      // numbers under a city label.
      throw new AppError(
        "VALIDATION_ERROR",
        "Serper does not support city-level tracking; local trackers use the DataForSEO path",
      );
    }
    const response = await serperSearch({
      keyword: input.keyword,
      country: input.country,
      language: input.language,
      // Pagination stops on the target's page, so only pages up to the find
      // are billed (see client).
      depth: input.depth,
      stopDomain: input.targetDomain,
    });
    return mapSerperResponse(input, response);
  },
};

/**
 * Snapshot of a keyword's Google results for the research SERP panel.
 * Fields DataForSEO fills (etv, backlinks info, rank change) are honestly
 * null/neutral — the panel already renders them as "no data".
 */
export async function serperSnapshotItems(input: {
  keyword: string;
  country: string;
  language: string;
  depth: number;
}): Promise<
  Array<{
    rank: number;
    title: string;
    url: string;
    domain: string;
    description: string;
  }>
> {
  const response = await serperSearch({
    keyword: input.keyword,
    country: input.country,
    language: input.language,
    // The panel shows the top of the SERP; paying for the full tracker depth
    // (up to 10 pages per keyword) buys nothing for a snapshot.
    depth: Math.min(input.depth, 20),
  });
  return response.organic.map((item, index) => ({
    rank: item.position ?? index + 1,
    title: item.title,
    url: item.link,
    domain: hostOf(item.link),
    description: item.snippet ?? "",
  }));
}
