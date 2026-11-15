import { AppError } from "@/server/lib/errors";
import type {
  SerpProvider,
  SerpRankCheck,
  SerpRankResult,
} from "@/server/lib/seo-providers/types";
import { yandexWebSearch } from "./client";

export const yandexProvider: SerpProvider = {
  id: "yandex",
  engines: ["yandex"],
  async checkRank(input: SerpRankCheck): Promise<SerpRankResult> {
    if (input.engine !== "yandex") {
      throw new AppError(
        "INTERNAL_ERROR",
        `yandex provider cannot serve engine "${input.engine}"`,
      );
    }
    // docsInGroup=1 makes array order the organic order (see client body).
    const docs = await yandexWebSearch({
      keyword: input.keyword,
      region: input.region,
    });
    const target = input.targetDomain.toLowerCase();
    const matchIndex = docs.findIndex(
      (doc) =>
        doc.domain !== "" &&
        (doc.domain === target || doc.domain.endsWith(`.${target}`)),
    );
    return {
      position: matchIndex === -1 ? null : matchIndex + 1,
      url: matchIndex === -1 ? null : docs[matchIndex].url,
      topResults: docs.slice(0, input.depth).map((doc, index) => ({
        position: index + 1,
        domain: doc.domain,
        url: doc.url,
        title: doc.title,
      })),
    };
  },
};
