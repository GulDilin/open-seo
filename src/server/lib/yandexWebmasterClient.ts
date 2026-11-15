import { z } from "zod";
import { getYandexWebmasterAccessToken } from "@/server/features/yandex/yandexOAuth";
import {
  YandexWebmasterApiError,
  YandexWebmasterTokenError,
} from "./yandexWebmasterErrors";

export { YandexWebmasterApiError } from "./yandexWebmasterErrors";

const API_BASE = "https://api.webmaster.yandex.net/v4";

// ---------------------------------------------------------------------------
// Wire schemas (Constitution IV: vendor names live only in this adapter).
// Examples copied from the Yandex Webmaster v4 docs — AT INTEGRATION: replay
// the four endpoints with live keys and compare field-by-field.
// ---------------------------------------------------------------------------

const userResponseSchema = z.object({ user_id: z.number() });

const hostSchema = z.object({
  host_id: z.string(),
  ascii_host_url: z.string(),
  unicode_host_url: z.string().optional(),
  verified: z.boolean(),
});

const hostsResponseSchema = z.object({ hosts: z.array(hostSchema) });

const hostInfoResponseSchema = z.looseObject({
  host_data_status: z.string().optional(),
  host_display_name: z.string().optional(),
});

const summaryResponseSchema = z.looseObject({
  sqi: z.number().optional(),
  excluded_pages_count: z.number().optional(),
  searchable_pages_count: z.number().optional(),
  site_problems: z.record(z.string(), z.number()).optional(),
});

// Yandex omits an indicator when its value is undefined for a query.
const queryIndicatorsSchema = z.looseObject({
  TOTAL_SHOWS: z.number().optional(),
  TOTAL_CLICKS: z.number().optional(),
  AVG_SHOW_POSITION: z.number().optional(),
  AVG_CLICK_POSITION: z.number().optional(),
});

const popularQueriesResponseSchema = z.object({
  queries: z.array(
    z.object({
      query_id: z.string(),
      query_text: z.string(),
      indicators: queryIndicatorsSchema.default({}),
    }),
  ),
  // Yandex clamps the requested window to what it actually has; callers must
  // render these, not the dates they asked for.
  date_from: z.string(),
  date_to: z.string(),
  // The docs type this as int32 but their own JSON example serializes "300"
  // as a string; coerce both shapes.
  count: z.coerce.number(),
});

const errorResponseSchema = z.looseObject({
  error_code: z.string().optional(),
  error_message: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Normalized internal types (what services and MCP tools consume).
// ---------------------------------------------------------------------------

export type YandexHost = {
  hostId: string;
  asciiHostUrl: string;
  verified: boolean;
};

type YandexHostInfo = {
  indexingStatus: string | null;
  displayName: string | null;
};

export type YandexSiteSummary = {
  sqi: number | null;
  searchablePagesCount: number | null;
  excludedPagesCount: number | null;
  problems: {
    fatal: number | null;
    critical: number | null;
    possibleProblem: number | null;
    recommendation: number | null;
  };
};

export type YandexQueryRow = {
  queryId: string;
  query: string;
  impressions: number | null;
  clicks: number | null;
  avgShowPosition: number | null;
  avgClickPosition: number | null;
};

type YandexPopularQueries = {
  rows: YandexQueryRow[];
  reportedDateFrom: string;
  reportedDateTo: string;
  totalCount: number;
};

export type YandexQueryOrderBy = "TOTAL_SHOWS" | "TOTAL_CLICKS";
export type YandexDeviceType = "ALL" | "DESKTOP" | "MOBILE_AND_TABLET";

type YandexPopularQueriesInput = {
  orderBy: YandexQueryOrderBy;
  deviceType: YandexDeviceType;
  dateFrom: string;
  dateTo: string;
  limit: number;
  offset: number;
};

function messageForStatus(status: number, errorCode?: string): string {
  if (status === 401 || status === 403) {
    return errorCode === "INVALID_USER_ID"
      ? "Yandex Webmaster rejected the stored connection (the grant belongs to a different Yandex user). Reconnect Yandex."
      : "Yandex Webmaster denied access. The connection may have been revoked, or the app lacks the webmaster:verify permission Yandex requires for data endpoints.";
  }
  if (status === 404) {
    if (errorCode === "HOST_NOT_VERIFIED")
      return "This site is no longer verified in the connected Yandex Webmaster account.";
    if (errorCode === "HOST_NOT_INDEXED")
      return "Yandex has not indexed this site yet.";
    if (errorCode === "HOST_NOT_LOADED")
      return "Yandex Webmaster has not loaded this site's data yet.";
    if (errorCode === "HOST_NOT_FOUND")
      return "This site is no longer in the connected Yandex Webmaster account.";
    return "Yandex Webmaster could not find the requested resource.";
  }
  if (status === 429) {
    return "Yandex Webmaster rate limit reached. Retry shortly.";
  }
  return `Yandex Webmaster API error (${status}).`;
}

/** Look up the token owner's Webmaster uid with an explicit access token —
 *  used by the OAuth callback to key the grant right after consent, before
 *  any grant exists to build a client from. */
export async function lookupYandexUid(accessToken: string): Promise<number> {
  const response = await fetch(`${API_BASE}/user`, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!response.ok) {
    throw new YandexWebmasterApiError(
      response.status,
      messageForStatus(response.status),
    );
  }
  return userResponseSchema.parse(await response.json()).user_id;
}

/** Free Yandex Webmaster client. First-party data with no per-call cost, so it
 *  does NOT meter credits. Tokens come from (and are refreshed against) the
 *  connector's stored yandex-webmaster grant. All responses are Zod-validated
 *  here and normalized to camelCase before leaving this module. */
export function createYandexWebmasterClient(opts: {
  userId: string;
  yandexAccountId?: string;
}) {
  async function getToken(): Promise<string> {
    try {
      return await getYandexWebmasterAccessToken({
        userId: opts.userId,
        accountId: opts.yandexAccountId,
      });
    } catch (error) {
      throw new YandexWebmasterTokenError(
        "Could not mint a Yandex Webmaster token (grant expired or revoked).",
        error,
      );
    }
  }

  async function request<T>(
    url: string,
    parse: (data: unknown) => T,
  ): Promise<T> {
    // Yandex answers "token_type": "bearer" but REQUIRES the OAuth scheme —
    // a Bearer header is rejected with 401.
    const response = await fetch(url, {
      headers: { Authorization: `OAuth ${await getToken()}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let wireBody: unknown = {};
      try {
        wireBody = body ? JSON.parse(body) : {};
      } catch {
        wireBody = {};
      }
      const parsed = errorResponseSchema.safeParse(wireBody);
      const wire = parsed.success ? parsed.data : {};
      throw new YandexWebmasterApiError(
        response.status,
        `${messageForStatus(response.status, wire.error_code)}${wire.error_message ? ` (${wire.error_message.slice(0, 200)})` : ""}`,
        wire.error_code,
        body,
      );
    }
    return parse(await response.json());
  }

  async function getUid(): Promise<number> {
    const data = await request(`${API_BASE}/user`, (d) =>
      userResponseSchema.parse(d),
    );
    return data.user_id;
  }

  // Every other endpoint needs the uid in its path; resolve it once per
  // client instance.
  let uid: Promise<number> | null = null;
  const resolveUid = () => (uid ??= getUid());

  return {
    async listHosts(): Promise<YandexHost[]> {
      const data = await request(
        `${API_BASE}/user/${await resolveUid()}/hosts`,
        (d) => hostsResponseSchema.parse(d),
      );
      return data.hosts.map((host) => ({
        hostId: host.host_id,
        asciiHostUrl: host.ascii_host_url,
        verified: host.verified,
      }));
    },

    async getHostInfo(hostId: string): Promise<YandexHostInfo> {
      const data = await request(
        `${API_BASE}/user/${await resolveUid()}/hosts/${encodeURIComponent(hostId)}`,
        (d) => hostInfoResponseSchema.parse(d),
      );
      return {
        indexingStatus: data.host_data_status ?? null,
        displayName: data.host_display_name ?? null,
      };
    },

    async getSummary(hostId: string): Promise<YandexSiteSummary> {
      const data = await request(
        `${API_BASE}/user/${await resolveUid()}/hosts/${encodeURIComponent(hostId)}/summary`,
        (d) => summaryResponseSchema.parse(d),
      );
      const problems = data.site_problems ?? {};
      return {
        sqi: data.sqi ?? null,
        searchablePagesCount: data.searchable_pages_count ?? null,
        excludedPagesCount: data.excluded_pages_count ?? null,
        problems: {
          fatal: problems.FATAL ?? null,
          critical: problems.CRITICAL ?? null,
          possibleProblem: problems.POSSIBLE_PROBLEM ?? null,
          recommendation: problems.RECOMMENDATION ?? null,
        },
      };
    },

    async getPopularQueries(
      hostId: string,
      input: YandexPopularQueriesInput,
    ): Promise<YandexPopularQueries> {
      const params = new URLSearchParams({
        order_by: input.orderBy,
        device_type_indicator: input.deviceType,
        date_from: input.dateFrom,
        date_to: input.dateTo,
        limit: String(input.limit),
        offset: String(input.offset),
      });
      // All four indicators are requested; Yandex omits the ones it cannot
      // compute for a given query.
      for (const indicator of [
        "TOTAL_SHOWS",
        "TOTAL_CLICKS",
        "AVG_SHOW_POSITION",
        "AVG_CLICK_POSITION",
      ]) {
        params.append("query_indicator", indicator);
      }
      const data = await request(
        `${API_BASE}/user/${await resolveUid()}/hosts/${encodeURIComponent(hostId)}/search-queries/popular?${params}`,
        (d) => popularQueriesResponseSchema.parse(d),
      );
      return {
        rows: data.queries.map((query) => ({
          queryId: query.query_id,
          query: query.query_text,
          impressions: query.indicators.TOTAL_SHOWS ?? null,
          clicks: query.indicators.TOTAL_CLICKS ?? null,
          avgShowPosition: query.indicators.AVG_SHOW_POSITION ?? null,
          avgClickPosition: query.indicators.AVG_CLICK_POSITION ?? null,
        })),
        // Yandex datetimes ("2016-01-07T00:00:00,000+0300") — the comma before
        // milliseconds breaks Date parsing; only the day is meaningful here.
        reportedDateFrom: data.date_from.slice(0, 10),
        reportedDateTo: data.date_to.slice(0, 10),
        totalCount: data.count,
      };
    },
  };
}
