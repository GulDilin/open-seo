import type {
  KeywordDataProvider,
  KeywordVolumeQuery,
  KeywordVolumeRow,
} from "@/server/lib/seo-providers/types";
import { AppError } from "@/server/lib/errors";
import { wordstatTopRequests } from "./client";

// Sequential chunks of 25: Yandex RPS quotas and the Workers subrequest
// limit both cap fan-out, and a flat Promise.all over the whole list would
// blow through both at refresh scale.
const WORDSTAT_CHUNK_SIZE = 25;

/**
 * Wordstat-backed keyword volumes for the Russia market. GetTop returns the
 * popular queries CONTAINING the phrase (plus associations), so a keyword's
 * volume is the exact-phrase row when present and honestly null otherwise —
 * never the containing-total, which overstates the keyword itself.
 * cpc/competition/difficulty do not exist in Wordstat: null, not invented.
 */
export const wordstatProvider: KeywordDataProvider = {
  id: "yandex",
  async getVolumes(queries: KeywordVolumeQuery[]): Promise<KeywordVolumeRow[]> {
    const rows: KeywordVolumeRow[] = [];
    for (let i = 0; i < queries.length; i += WORDSTAT_CHUNK_SIZE) {
      const chunk = await Promise.all(
        queries.slice(i, i + WORDSTAT_CHUNK_SIZE).map((query) =>
          wordstatVolume(query).then(
            (volume): KeywordVolumeRow => ({
              keyword: query.keyword,
              volume,
              cpc: null,
              competition: null,
              difficulty: null,
              source: "wordstat",
            }),
          ),
        ),
      );
      rows.push(...chunk);
    }
    return rows;
  },
};

async function wordstatVolume(
  query: KeywordVolumeQuery,
): Promise<number | null> {
  // Yandex rejects phrases over 400 characters with INVALID_ARGUMENT, and
  // auto-imported panel queries can exceed the UI's keyword-length cap —
  // return an honest null instead of failing the whole refresh.
  if (query.keyword.length > 400) return null;
  // A phrase with no letters or digits (operator/punctuation-only) can never
  // match Wordstat's grammar — skip it without a round-trip.
  if (!/[\p{L}\p{N}]/u.test(query.keyword)) return null;
  // Regions on the volume query are Yandex region ids (numeric strings). A
  // non-numeric region (e.g. a DataForSEO city label) is not an id — drop it
  // rather than send Wordstat a name it would reject or mis-scope.
  const regionId = query.region?.match(/^\d+$/)?.[0];
  let top;
  try {
    top = await wordstatTopRequests({
      phrase: query.keyword,
      regions: regionId ? [regionId] : undefined,
    });
  } catch (error) {
    // A 4xx is this phrase's problem, not the batch's: auto-imported panel
    // queries can carry Search-API-invalid syntax (e.g. an unbalanced quote),
    // and Yandex answers 400 "Invalid query". Null the volume, name the
    // phrase in the logs, let sibling keywords proceed. Anything else (auth,
    // throttle, 5xx) is infrastructure — rethrow so the refresh retries.
    if (isPerPhraseRejection(error)) {
      console.warn(
        `[wordstat] invalid phrase, volume nulled: ${JSON.stringify(query.keyword.slice(0, 80))}`,
      );
      return null;
    }
    throw error;
  }
  const exact = top.results.find(
    (row) => row.phrase.toLowerCase() === query.keyword.toLowerCase(),
  );
  return exact ? Number(exact.count) : null;
}

function isPerPhraseRejection(error: unknown): boolean {
  // Provider error contract: 4xx is permanent (this phrase is unfixable),
  // except 429 which is throttle like 5xx — those rethrow and retry.
  if (!(error instanceof AppError) || error.code !== "UPSTREAM_UNAVAILABLE") {
    return false;
  }
  const status = error.details?.providerStatus;
  return (
    error.details?.provider === "yandex" &&
    status !== undefined &&
    status !== "429" &&
    status.startsWith("4")
  );
}
