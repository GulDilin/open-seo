import { z } from "zod";

/**
 * Search engines and SEO data providers shared by client pickers, server
 * validation, and MCP tool validation — one table so the three cannot drift
 * (constitution: Provider Normalization at the Boundary).
 *
 * Engines and provider chains exist before their provider integrations ship
 * (the provider-migration phases add credentials and adapters one by one);
 * availability stays the product's own decision, not a provider fact.
 */

export const SEARCH_ENGINES = ["google", "yandex", "baidu", "bing"] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

/** The single validation point for engine names at every trust boundary. */
export const searchEngineSchema = z.enum(SEARCH_ENGINES);
/** Form-friendly field: omitted engines mean today's default, google. */
export const searchEngineField = searchEngineSchema.default("google");

export const SEO_PROVIDER_IDS = [
  "serper",
  "yandex",
  "brightdata",
  "googleads",
  "dataforseo",
] as const;
export type ProviderId = (typeof SEO_PROVIDER_IDS)[number];

/**
 * Priority chain per engine: the first CONFIGURED provider serves it. The
 * incumbent stays google's fallback until the exit phase removes it.
 */
export const SERP_PROVIDER_CHAIN: Record<SearchEngine, readonly ProviderId[]> =
  {
    google: ["serper", "dataforseo"],
    yandex: ["yandex"],
    baidu: ["brightdata"],
    bing: ["brightdata"],
  };

/**
 * Env vars whose presence configures a provider (empty/whitespace counts as
 * absent — same rule everywhere). Yandex needs both key and folder id;
 * googleads (BYO keyword volumes, decisions §8) needs the operator's own
 * Ads customer + OAuth refresh token and reuses the app's Google client.
 */
export const SEO_PROVIDER_CREDENTIALS: Record<ProviderId, readonly string[]> = {
  serper: ["SERPER_API_KEY"],
  yandex: ["YANDEX_SEARCH_API_KEY", "YANDEX_FOLDER_ID"],
  brightdata: ["BRIGHTDATA_API_TOKEN"],
  googleads: [
    "GOOGLE_ADS_CUSTOMER_ID",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ],
  dataforseo: ["DATAFORSEO_API_KEY"],
};

/** Engines each provider can serve — must agree with SERP_PROVIDER_CHAIN. */
export const SEO_PROVIDER_ENGINES: Record<ProviderId, readonly SearchEngine[]> =
  {
    serper: ["google"],
    yandex: ["yandex"],
    brightdata: ["baidu", "bing"],
    googleads: [], // volume-only provider, not in any SERP chain
    dataforseo: ["google"],
  };

/**
 * Markets offering engines beyond the default google. Codes follow the
 * market registry in keyword-locations.ts (DataForSEO codes for existing
 * markets; ISO 3166-1 numeric for Russia 643 and China 156). Unlisted
 * markets serve google only — the pre-migration behavior. Module-private:
 * enginesForCountry is the only public reader.
 */
const ENGINE_AVAILABILITY: Record<number, readonly SearchEngine[]> = {
  // Russia: both engines. google is served by Serper only — DataForSEO does
  // not cover Russia, so tracker creation gates google-RU on SERPER_API_KEY
  // (RankTrackingService + workflow) with a clear error when it is missing.
  643: ["yandex", "google"],
  156: ["baidu"], // China — Google does not meaningfully operate there
  2578: ["google", "bing"], // Norway
};

const DEFAULT_ENGINES: readonly SearchEngine[] = ["google"];

export function enginesForCountry(code: number): readonly SearchEngine[] {
  return ENGINE_AVAILABILITY[code] ?? DEFAULT_ENGINES;
}

export function isEngineAvailableForCountry(
  code: number,
  engine: SearchEngine,
): boolean {
  return enginesForCountry(code).includes(engine);
}
