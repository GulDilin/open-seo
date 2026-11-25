/* eslint-disable max-lines -- one wire adapter per vendor: every Bing Webmaster
 * JSON endpoint normalizes to camelCase here so vendor names live only in this
 * file */
import { z } from "zod";
import { BingWebmasterApiError } from "./bingWebmasterErrors";

export { BingWebmasterApiError } from "./bingWebmasterErrors";

// Bing Webmaster's JSON protocol (learn.microsoft.com/en-us/bingwebmaster/
// api-protocols): GET https://ssl.bing.com/webmaster/api.svc/json/METHOD?
// apikey=API_KEY&param=VALUE. Auth is the static API key the user generates in
// Bing Webmaster Tools (Settings → API access) — there is no OAuth flow for
// this API. Methods confirmed against the method pages on learn.microsoft.com:
//   GetUserSites()                            → { d: [ { Url, IsVerified } ] }
//   GetQueryStats(siteUrl)                    → { d: [ { Query, Clicks,
//         Impressions, AvgClickPosition, AvgImpressionPosition, Date } ] }
//   GetLinkCounts(siteUrl, page)              → { d: { Links: [ { Url, Count } ],
//         TotalPages } }  — pages of the site that have inbound links
//   GetUrlLinks(siteUrl, link, page)          → { d: { Details: [ { Url,
//         AnchorText } ], TotalPages } }  — inbound links for one target URL
// The `d` wrapper holds a list for the report methods and an object for the
// link methods. GetQueryStats has no date parameters: it returns every weekly
// bucket Bing has (weekly refresh), so windowing happens in the service. Bing
// has no dated link-count history and no site-wide link total — GetLinkCounts
// counts inbound links per page.

const API_BASE = "https://ssl.bing.com/webmaster/api.svc/json";

// ---------------------------------------------------------------------------
// Wire schemas. Examples copied from the official method pages — AT
// INTEGRATION: replay the four endpoints with a live key and compare
// field-by-field.
// ---------------------------------------------------------------------------

const siteSchema = z.looseObject({
  Url: z.string(),
  IsVerified: z.boolean().nullish(),
});

const userSitesResponseSchema = z.object({
  d: z.array(siteSchema).nullish(),
});

const queryStatsSchema = z.looseObject({
  Query: z.string(),
  Clicks: z.coerce.number().nullish(),
  Impressions: z.coerce.number().nullish(),
  AvgClickPosition: z.coerce.number().nullish(),
  AvgImpressionPosition: z.coerce.number().nullish(),
  Date: z.string(),
});

const queryStatsResponseSchema = z.object({
  d: z.array(queryStatsSchema).nullish(),
});

const linkCountsResponseSchema = z.object({
  d: z
    .looseObject({
      Links: z
        .array(
          z.object({
            Url: z.string(),
            Count: z.coerce.number().nullish(),
          }),
        )
        .nullish(),
      TotalPages: z.coerce.number().nullish(),
    })
    .nullish(),
});

const urlLinksResponseSchema = z.object({
  d: z
    .looseObject({
      Details: z
        .array(
          z.object({
            // The linking (source) page; AnchorText may be missing.
            Url: z.string(),
            AnchorText: z.string().nullish(),
          }),
        )
        .nullish(),
      TotalPages: z.coerce.number().nullish(),
    })
    .nullish(),
});

const errorResponseSchema = z.looseObject({
  ErrorCode: z.coerce.number().nullish(),
  Message: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Normalized internal types (what services and pages consume).
// ---------------------------------------------------------------------------

export type BingSite = {
  siteUrl: string;
  verified: boolean;
};

export type BingQueryStatsRow = {
  date: string;
  query: string;
  impressions: number | null;
  clicks: number | null;
  avgImpressionPosition: number | null;
  avgClickPosition: number | null;
};

export type BingQueryStats = {
  rows: BingQueryStatsRow[];
  /** First and last weekly bucket Bing reported, or null when it has none. */
  reportedDateFrom: string | null;
  reportedDateTo: string | null;
};

export type BingLinkCounts = {
  links: Array<{ url: string; count: number }>;
  /** Bing's page count for the site's linked pages — loaded pages are a
   *  subset, so the UI can say more is available. */
  totalPages: number | null;
};

export type BingLinkDetails = {
  details: Array<{ sourceUrl: string; anchorText: string | null }>;
  totalPages: number | null;
};

/** Bing JSON dates arrive as "/Date(1316156400000-0700)/" (epoch ms plus an
 *  optional offset); the XML protocol serializes ISO strings for the same
 *  fields. Accept both — only the UTC day is meaningful for weekly buckets. */
function toIsoDate(value: string): string | null {
  const ms = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  const time = ms ? Number(ms[1]) : Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

/** Bing documents HTTP 400 with `{"ErrorCode":3,"Message":"InvalidApiKey"}`.
 *  Errors raised here name the endpoint, not a raw Zod dump. */
async function parseError(status: number, body: string): Promise<never> {
  let wire: z.infer<typeof errorResponseSchema> = {};
  try {
    const parsed = errorResponseSchema.safeParse(
      body ? JSON.parse(body) : {},
    );
    if (parsed.success) wire = parsed.data;
  } catch {
    // Non-JSON error body — fall through with the message below.
  }
  const message = wire.Message?.slice(0, 200);
  throw new BingWebmasterApiError(
    status,
    `Bing Webmaster API error (${status})${message ? `: ${message}` : "."}`,
    wire.ErrorCode ?? undefined,
    body,
  );
}

export function createBingWebmasterClient(opts: { apiKey: string }) {
  async function request<T>(
    method: string,
    params: URLSearchParams,
    parse: (data: unknown) => T,
  ): Promise<T> {
    params.set("apikey", opts.apiKey);
    const response = await fetch(`${API_BASE}/${method}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      await parseError(
        response.status,
        await response.text().catch(() => ""),
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new BingWebmasterApiError(
        response.status,
        `Bing Webmaster returned a non-JSON response for ${method}.`,
      );
    }
    // Some errors come back with HTTP 200 and only the ErrorCode body — a
    // response without the `d` payload is not data.
    if (
      data &&
      typeof data === "object" &&
      "ErrorCode" in data &&
      !("d" in data)
    ) {
      await parseError(response.status, JSON.stringify(data));
    }
    try {
      return parse(data);
    } catch (error) {
      throw new BingWebmasterApiError(
        response.status,
        `Bing Webmaster returned an unexpected response shape for ${method}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
      );
    }
  }

  return {
    /** Every site registered on the key's account. */
    async getUserSites(): Promise<BingSite[]> {
      const data = await request(
        "GetUserSites",
        new URLSearchParams(),
        (d) => userSitesResponseSchema.parse(d),
      );
      return (data.d ?? []).map((site) => ({
        siteUrl: site.Url,
        verified: site.IsVerified ?? false,
      }));
    },

    /** Every weekly query bucket Bing has, per query, no date windowing. */
    async getQueryStats(siteUrl: string): Promise<BingQueryStats> {
      const data = await request(
        "GetQueryStats",
        new URLSearchParams({ siteUrl }),
        (d) => queryStatsResponseSchema.parse(d),
      );
      const rows = (data.d ?? []).flatMap((row) => {
        const date = toIsoDate(row.Date);
        return date
          ? [
              {
                date,
                query: row.Query,
                impressions: row.Impressions ?? null,
                clicks: row.Clicks ?? null,
                avgImpressionPosition: row.AvgImpressionPosition ?? null,
                avgClickPosition: row.AvgClickPosition ?? null,
              },
            ]
          : [];
      });
      return {
        rows,
        reportedDateFrom:
          rows.length > 0
            ? rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0].date)
            : null,
        reportedDateTo:
          rows.length > 0
            ? rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0].date)
            : null,
      };
    },

    /** One page of the site's URLs with inbound-link counts. `page` is
     *  0-based; Bing's page size is not documented, so callers stop on an
     *  empty page or their own cap. */
    async getLinkCounts(siteUrl: string, page: number): Promise<BingLinkCounts> {
      const data = await request(
        "GetLinkCounts",
        new URLSearchParams({ siteUrl, page: String(page) }),
        (d) => linkCountsResponseSchema.parse(d),
      );
      return {
        links: (data.d?.Links ?? []).flatMap((link) =>
          link.Count === null || link.Count === undefined
            ? []
            : [{ url: link.Url, count: link.Count }],
        ),
        totalPages: data.d?.TotalPages ?? null,
      };
    },

    /** One page of the inbound links for one target URL of `siteUrl` — the
     *  linking (source) page plus its anchor text. The docs' JSON example
     *  URL-encodes the link value the standard way. */
    async getUrlLinks(
      siteUrl: string,
      link: string,
      page: number,
    ): Promise<BingLinkDetails> {
      const data = await request(
        "GetUrlLinks",
        new URLSearchParams({
          siteUrl,
          link,
          page: String(page),
        }),
        (d) => urlLinksResponseSchema.parse(d),
      );
      return {
        details: (data.d?.Details ?? []).map((detail) => ({
          sourceUrl: detail.Url,
          anchorText: detail.AnchorText ?? null,
        })),
        totalPages: data.d?.TotalPages ?? null,
      };
    },
  };
}
