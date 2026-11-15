import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { getRequiredEnvValue } from "@/server/lib/runtime-env";
import { parseYandexDocs, type YandexDoc } from "./xml";

/**
 * Yandex Search API client (searchapi.api.cloud.yandex.net).
 * Auth: service-account API key + folder id on every call.
 * Facts pinned from the official API reference (October 2026):
 * - web search: POST /v2/web/search → { rawData: base64 XML }
 * - wordstat top requests: POST /v2/wordstat/topRequests
 *   → { totalCount, results: [{ phrase, count }] } (counts are int64 strings)
 *
 * ponytail: sync search only, including scheduled runs — deferred collection
 * (~16x cheaper) returns the same base64 XML via an Operation object and
 * needs a poller; add it when scheduled Yandex volume makes the ~488 ₽/1000
 * sync price a real line item.
 */

const wordstatPhraseSchema = z.object({
  phrase: z.string(),
  count: z.string(),
});

const topRequestsSchema = z.object({
  totalCount: z.string().optional(),
  results: z.array(wordstatPhraseSchema).default([]),
  associations: z.array(wordstatPhraseSchema).default([]),
});

const API_BASE = "https://searchapi.api.cloud.yandex.net";

// Search API enforces a per-second quota and answers bursts with 429 — a
// rank-check batch fires its keywords concurrently. Serialize every call
// module-wide with a minimum gap so the quota is never overshot, and wait out
// the window before the one 429/5xx retry (an immediate retry re-enters the
// same spent second and 429s again).
const MIN_REQUEST_GAP_MS = 1_100;
let lastRequestAt = 0;
let callQueue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yandexThrottled<T>(run: () => Promise<T>): Promise<T> {
  const result = callQueue.then(async () => {
    const gap = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();
    return run();
  });
  callQueue = result.catch(() => undefined);
  return result;
}

async function yandexFetch(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const [apiKey, folderId] = await Promise.all([
    getRequiredEnvValue("YANDEX_SEARCH_API_KEY"),
    getRequiredEnvValue("YANDEX_FOLDER_ID"),
  ]);
  const request = () =>
    fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ folderId, ...body }),
      signal: AbortSignal.timeout(30_000),
    });

  return yandexThrottled(async () => {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Yandex Search API request failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    // One retry on 429/5xx after waiting out the quota window — paid calls
    // must not retry aggressively.
    if (response.status === 429 || response.status >= 500) {
      await sleep(MIN_REQUEST_GAP_MS);
      try {
        response = await request();
      } catch (error) {
        throw new AppError(
          "UPSTREAM_UNAVAILABLE",
          `Yandex Search API request failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }
    if (!response.ok) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Yandex Search API responded ${response.status}`,
      );
    }
    return response.json();
  });
}

const SEARCH_BODY_FIXED = {
  query: {
    searchType: "SEARCH_TYPE_RU",
    familyMode: "FAMILY_MODE_NONE",
  },
  // One doc per group keeps positions linear: doc #N is organic position N.
  groupSpec: { groupsOnPage: 100, docsInGroup: 1 },
  maxPassages: 1,
  responseFormat: "FORMAT_XML",
} as const;

export async function yandexWebSearch(input: {
  keyword: string;
  /** Yandex region id (GetRegionsTree); absent = national results. */
  region?: string;
}): Promise<YandexDoc[]> {
  const parsed = z
    .object({ rawData: z.string() })
    .passthrough()
    .parse(
      await yandexFetch("/v2/web/search", {
        ...SEARCH_BODY_FIXED,
        query: { ...SEARCH_BODY_FIXED.query, queryText: input.keyword },
        ...(input.region ? { region: input.region } : {}),
      } satisfies Record<string, unknown>),
    );
  // atob returns a Latin-1 binary string, which mangles multi-byte UTF-8
  // (every Cyrillic title); decode the bytes as UTF-8 instead.
  const xml = new TextDecoder().decode(
    Uint8Array.from(atob(parsed.rawData), (byte) => byte.charCodeAt(0)),
  );
  return parseYandexDocs(xml);
}

export async function wordstatTopRequests(input: {
  phrase: string;
  numPhrases?: number;
  /** Yandex region ids scoping the demand. */
  regions?: string[];
}): Promise<z.infer<typeof topRequestsSchema>> {
  const raw = await yandexFetch("/v2/wordstat/topRequests", {
    phrase: input.phrase,
    numPhrases: input.numPhrases ?? 100,
    ...(input.regions?.length ? { regions: input.regions } : {}),
  });
  return topRequestsSchema.parse(raw);
}
