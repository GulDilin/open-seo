import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/**
 * Google Ads API keyword volumes (BYO credentials, decisions §8).
 *
 * Auth: the operator's own OAuth refresh token exchanged for a short-lived
 * access token (the adwords scope); client id/secret reuse the app's
 * existing GOOGLE_CLIENT_* pair. Each operator runs against their own
 * Cloud project — a shared token for other users is what Google's
 * September 2026 policy bans; own use is explicitly allowed.
 *
 * Data: generateKeywordIdeas — avg monthly searches (bucketed without ad
 * spend), competition enum, 12-month history, and CPC via averageCpcMicros
 * (only returned when historicalMetricsOptions.includeAverageCpc is set).
 * No difficulty (never invented). Our numeric location codes ARE Google geo
 * target criterion ids for the 2xxx registry entries (US 2840, Norway
 * 2578); Russia 643 / China 156 are ISO 3166-1 numeric placeholders and
 * never route here (wordstat/none providers), so the resource name is
 * derived directly.
 */

const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";
// Version pin (quarterly rotations); v26 is the current release.
const API_VERSION = "v26";

/** Google Ads month enum names (MonthOfYear) → calendar month numbers. */
const MONTH_NUMBERS: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

const ideasResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            text: z.string().optional(),
            keywordIdeaMetrics: z
              .object({
                avgMonthlySearches: z.string().nullable().optional(),
                competition: z.string().nullable().optional(),
                averageCpcMicros: z.string().nullable().optional(),
                monthlySearchVolumes: z
                  .array(
                    z.object({
                      year: z.string().nullable().optional(),
                      // MonthOfYear enum name ("JANUARY".."DECEMBER").
                      month: z.string().nullable().optional(),
                      monthlySearches: z.string().nullable().optional(),
                    }),
                  )
                  .default([]),
              })
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

interface GoogleAdsKeywordIdea {
  keyword: string;
  volume: number | null;
  /** Average CPC in currency units (micros / 1e6, 4 decimals); null = none. */
  cpc: number | null;
  competitionEnum: string | null;
  monthly: Array<{ year: number; month: number; searchVolume: number }>;
}

async function getAccessToken(): Promise<string> {
  const [refreshToken, clientId, clientSecret] = await Promise.all([
    getOptionalEnvValue("GOOGLE_ADS_REFRESH_TOKEN"),
    getOptionalEnvValue("GOOGLE_CLIENT_ID"),
    getOptionalEnvValue("GOOGLE_CLIENT_SECRET"),
  ]);
  if (!refreshToken || !clientId || !clientSecret) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Google Ads volumes need GOOGLE_ADS_REFRESH_TOKEN (+ GOOGLE_CLIENT_ID/SECRET)",
    );
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: ADWORDS_SCOPE,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Google OAuth token refresh responded ${response.status}`,
    );
  }
  const json = z
    .object({ access_token: z.string() })
    .parse(await response.json());
  return json.access_token;
}

export async function generateKeywordIdeas(input: {
  keywords: string[];
  locationCode: number; // Google geo target criterion id
  languageCode: string;
  ideaCount?: number;
}): Promise<GoogleAdsKeywordIdea[]> {
  const [accessToken, customerId] = await Promise.all([
    getAccessToken(),
    getRequiredCustomerId(),
  ]);
  const response = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/keywordPlanIdeas:generateKeywordIdeas`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      // Field names follow the REST examples (camelCase). Language is
      // omitted: idea language follows the customer account's locale; geo
      // targeting carries the market. ponytail: add a languageConstant
      // mapping if operators need non-default languages.
      body: JSON.stringify({
        keywordSeed: { keywords: input.keywords },
        pageSize: input.ideaCount ?? 100,
        keywordPlanNetwork: "GOOGLE_SEARCH",
        geoTargetConstants: [`geoTargetConstants/${input.locationCode}`],
        // averageCpcMicros is only returned when explicitly requested.
        historicalMetricsOptions: { includeAverageCpc: true },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Google Ads API responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const parsed = ideasResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Google Ads response failed schema validation",
    );
  }
  return parsed.data.results.map((result) => ({
    keyword: result.text ?? "",
    volume: result.keywordIdeaMetrics?.avgMonthlySearches
      ? Number(result.keywordIdeaMetrics.avgMonthlySearches)
      : null,
    cpc: result.keywordIdeaMetrics?.averageCpcMicros
      ? Math.round(
          (Number(result.keywordIdeaMetrics.averageCpcMicros) / 1_000_000) *
            10_000,
        ) / 10_000
      : null,
    competitionEnum: result.keywordIdeaMetrics?.competition ?? null,
    monthly: (result.keywordIdeaMetrics?.monthlySearchVolumes ?? [])
      .filter((m) => m.year && m.month && m.monthlySearches)
      .map((m) => ({
        year: Number(m.year),
        month: MONTH_NUMBERS[m.month!] ?? 0,
        searchVolume: Number(m.monthlySearches),
      })),
  }));
}

async function getRequiredCustomerId(): Promise<string> {
  const customerId = await getOptionalEnvValue("GOOGLE_ADS_CUSTOMER_ID");
  if (!customerId) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Google Ads volumes need GOOGLE_ADS_CUSTOMER_ID",
    );
  }
  return customerId;
}
