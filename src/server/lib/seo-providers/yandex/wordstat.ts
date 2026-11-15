import type {
  KeywordDataProvider,
  KeywordVolumeQuery,
  KeywordVolumeRow,
} from "@/server/lib/seo-providers/types";
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
  // Regions on the volume query are Yandex region ids (numeric strings). A
  // non-numeric region (e.g. a DataForSEO city label) is not an id — drop it
  // rather than send Wordstat a name it would reject or mis-scope.
  const regionId = query.region?.match(/^\d+$/)?.[0];
  const top = await wordstatTopRequests({
    phrase: query.keyword,
    regions: regionId ? [regionId] : undefined,
  });
  const exact = top.results.find(
    (row) => row.phrase.toLowerCase() === query.keyword.toLowerCase(),
  );
  return exact ? Number(exact.count) : null;
}
