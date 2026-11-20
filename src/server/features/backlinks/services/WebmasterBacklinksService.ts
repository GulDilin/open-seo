import { YandexConnectionRepository } from "@/server/features/yandex/repositories/YandexConnectionRepository";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { isExpectedGrantFailure } from "@/server/features/yandex/services/YandexWebmasterService";
import { createYandexWebmasterClient } from "@/server/lib/yandexWebmasterClient";
import { WebmasterBacklinksRepository } from "../repositories/WebmasterBacklinksRepository";

// Yandex caps /links/external/samples at 100 per page. Five pages balance API
// load against a useful sample set; `count` (Yandex's pool size) is surfaced so
// the UI can say "more available in Yandex Webmaster" instead of hiding it.
const SAMPLES_PAGE_SIZE = 100;
const SAMPLES_MAX_PAGES = 5;

// Re-collect at most twice a day; reads in between are served from storage.
const COLLECT_TTL_MS = 12 * 60 * 60 * 1000;

const SAMPLES_PAGE_LIMIT = 100;

type YandexBacklinksPart = {
  connected: boolean;
  hostUrl: string | null;
  // Why live data is missing when it is — dead grant etc. Rendered instead of
  // silent zeros.
  unavailableReason: string | null;
  latest: { date: string; linksTotalCount: number } | null;
  history: Array<{ date: string; linksTotalCount: number }>;
  samples: Array<{
    sourceUrl: string;
    destinationUrl: string;
    discoveryDate: string | null;
    sourceLastAccessDate: string | null;
  }>;
  storedSamplesCount: number;
  // We store at most SAMPLES_MAX_PAGES * SAMPLES_PAGE_SIZE rows even when
  // Yandex's pool is larger.
  samplesTruncated: boolean;
  lastCollectedAt: string | null;
  // Why a collect attempt failed, when stored data may be stale.
  collectError: string | null;
};

type WebmasterBacklinksResult = {
  yandex: YandexBacklinksPart;
  gsc: {
    connected: boolean;
    siteUrl: string | null;
    // Static API fact, not a runtime value: Google exposes no links endpoint.
    apiProvidesLinks: false;
  };
};

function emptyYandexPart(
  overrides: Partial<
    Pick<YandexBacklinksPart, "connected" | "hostUrl" | "unavailableReason">
  > = {},
): YandexBacklinksPart {
  return {
    connected: false,
    hostUrl: null,
    unavailableReason: null,
    latest: null,
    history: [],
    samples: [],
    storedSamplesCount: 0,
    samplesTruncated: false,
    lastCollectedAt: null,
    collectError: null,
    ...overrides,
  };
}

/** Pull external-links history and sample pages from Yandex Webmaster and
 *  persist them. Errors propagate — the caller decides how to degrade. */
async function collectFromYandex(input: {
  projectId: string;
  hostId: string;
  connectedByUserId: string;
  yandexAccountId: string | null;
}): Promise<void> {
  const client = createYandexWebmasterClient({
    userId: input.connectedByUserId,
    yandexAccountId: input.yandexAccountId ?? undefined,
  });
  const capturedAt = new Date().toISOString();

  const history = await client.getExternalLinksHistory(input.hostId);
  await WebmasterBacklinksRepository.saveSnapshots(
    history.flatMap((point) =>
      point.linksTotalCount === null
        ? []
        : [
            {
              projectId: input.projectId,
              source: "yandex_webmaster" as const,
              linksTotalCount: point.linksTotalCount,
              date: point.date,
              capturedAt,
            },
          ],
    ),
  );

  let offset = 0;
  for (let page = 0; page < SAMPLES_MAX_PAGES; page += 1) {
    const result = await client.getExternalLinksSamples(input.hostId, {
      limit: SAMPLES_PAGE_SIZE,
      offset,
    });
    if (result.links.length === 0) break;
    await WebmasterBacklinksRepository.saveSamples(
      result.links.map((link) => ({
        projectId: input.projectId,
        source: "yandex_webmaster" as const,
        sourceUrl: link.sourceUrl,
        destinationUrl: link.destinationUrl,
        discoveryDate: link.discoveryDate,
        sourceLastAccessDate: link.sourceLastAccessDate,
        seenAt: capturedAt,
      })),
    );
    offset += result.links.length;
    if (result.links.length < SAMPLES_PAGE_SIZE) break;
  }
}

/** The Backlinks-page payload: stored link data for every connected webmaster,
 *  collecting from Yandex first when the stored data is stale. GSC carries
 *  connection state only — its API has no links endpoints (the Links report is
 *  UI-export only), so the UI explains that instead of showing zeros. */
async function getBacklinks(input: {
  projectId: string;
}): Promise<WebmasterBacklinksResult> {
  const [yandexConnection, gscConnection] = await Promise.all([
    YandexConnectionRepository.getByProjectId(input.projectId),
    GscConnectionRepository.getByProjectId(input.projectId),
  ]);

  if (!yandexConnection) {
    return {
      yandex: emptyYandexPart(),
      gsc: {
        connected: Boolean(gscConnection),
        siteUrl: gscConnection?.siteUrl ?? null,
        apiProvidesLinks: false,
      },
    };
  }

  let unavailableReason: string | null = null;
  let collectError: string | null = null;
  const lastCollected = await WebmasterBacklinksRepository.lastCollectedAt(
    input.projectId,
    "yandex_webmaster",
  );
  const stale =
    lastCollected === null ||
    Date.now() - Date.parse(lastCollected) > COLLECT_TTL_MS;
  if (stale) {
    try {
      await collectFromYandex({
        projectId: input.projectId,
        hostId: yandexConnection.hostId,
        connectedByUserId: yandexConnection.connectedByUserId,
        yandexAccountId: yandexConnection.yandexAccountId,
      });
    } catch (error) {
      if (isExpectedGrantFailure(error)) {
        unavailableReason =
          error instanceof Error ? error.message : String(error);
      } else {
        collectError =
          error instanceof Error ? error.message : String(error);
        console.error("webmaster_backlinks_collect_failed", {
          projectId: input.projectId,
          reason: collectError,
        });
      }
    }
  }

  // A dead grant surfaces as disconnected even if older data exists — the
  // numbers would silently stop moving otherwise.
  if (unavailableReason !== null) {
    return {
      yandex: emptyYandexPart({
        hostUrl: yandexConnection.hostUrl,
        unavailableReason,
      }),
      gsc: {
        connected: Boolean(gscConnection),
        siteUrl: gscConnection?.siteUrl ?? null,
        apiProvidesLinks: false,
      },
    };
  }

  const [history, samples, storedSamplesCount, collectedAt] = await Promise.all([
    WebmasterBacklinksRepository.listSnapshots(
      input.projectId,
      "yandex_webmaster",
    ),
    WebmasterBacklinksRepository.listSamples(
      input.projectId,
      "yandex_webmaster",
      SAMPLES_PAGE_LIMIT,
    ),
    WebmasterBacklinksRepository.countSamples(
      input.projectId,
      "yandex_webmaster",
    ),
    // Re-read: a collect above may have just written fresh rows.
    WebmasterBacklinksRepository.lastCollectedAt(
      input.projectId,
      "yandex_webmaster",
    ),
  ]);

  return {
    yandex: {
      connected: true,
      hostUrl: yandexConnection.hostUrl,
      unavailableReason: null,
      latest: history.length > 0 ? history[history.length - 1] : null,
      history,
      samples,
      storedSamplesCount,
      samplesTruncated:
        storedSamplesCount >= SAMPLES_MAX_PAGES * SAMPLES_PAGE_SIZE,
      lastCollectedAt: collectedAt,
      collectError,
    },
    gsc: {
      connected: Boolean(gscConnection),
      siteUrl: gscConnection?.siteUrl ?? null,
      apiProvidesLinks: false,
    },
  };
}

export const WebmasterBacklinksService = {
  getBacklinks,
};
