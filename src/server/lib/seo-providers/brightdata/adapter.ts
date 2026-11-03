import { AppError } from "@/server/lib/errors";
import type {
  SerpProvider,
  SerpRankCheck,
  SerpRankResult,
} from "@/server/lib/seo-providers/types";
import { matchesTargetDomain } from "../domain-match";
import { brightDataSearch } from "./client";

/** One adapter serves both engines — same API, the engine selects the URL. */
export const brightDataProvider: SerpProvider = {
  id: "brightdata",
  engines: ["baidu", "bing"],
  async checkRank(input: SerpRankCheck): Promise<SerpRankResult> {
    if (input.engine !== "baidu" && input.engine !== "bing") {
      // Asserted before any network call — a misrouted engine must never
      // cost a paid request.
      throw new AppError(
        "INTERNAL_ERROR",
        `brightdata provider cannot serve engine "${input.engine}"`,
      );
    }
    const organic = await brightDataSearch({
      engine: input.engine,
      keyword: input.keyword,
      country: input.country,
      language: input.language,
      // Bing pagination stops on the target's page, so only pages up to the
      // find are billed; Baidu is single-shot (see client).
      depth: input.depth,
      stopDomain: input.targetDomain,
    });
    const target = input.targetDomain.toLowerCase();
    const match = organic.find((item) =>
      matchesTargetDomain(item.domain, target),
    );
    // The engine's own page ceiling can leave fewer rows than depth — that
    // is what the provider returned, never silently padded.
    return {
      position: match?.position ?? null,
      url: match?.url ?? null,
      topResults: organic.slice(0, input.depth),
    };
  },
};
