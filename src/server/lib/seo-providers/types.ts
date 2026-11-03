import type { ProviderId, SearchEngine } from "@/shared/search-engines";
import type { MonthlySearch } from "@/types/keywords";

/**
 * Provider-facing contracts for SEO data. Adapters normalize their service's
 * wire format to these shapes; feature code never sees a vendor payload
 * (constitution: Provider Normalization at the Boundary).
 *
 * No implementations ship with this skeleton beyond credential presence —
 * the provider-migration phases add them (serper, yandex, brightdata) and
 * wrap the existing dataforseo lib.
 */

export interface SerpRankCheck {
  keyword: string;
  engine: SearchEngine;
  /** ISO 3166-1 alpha-2 (derived from the market's numeric code). */
  country: string;
  /** ISO 639-1 / SERP language code as used by the market pickers. */
  language: string;
  /** Provider-scoped region id (e.g. a Yandex region); absent = national. */
  region?: string;
  device: "desktop" | "mobile";
  targetDomain: string;
  /** 10..100; providers clamp to their own single-request maximum. */
  depth: number;
}

export interface SerpRankResult {
  /** 1-based organic position; null = target not ranking. */
  position: number | null;
  url: string | null;
  topResults: Array<{
    position: number;
    domain: string;
    url: string;
    title: string;
  }>;
}

export interface SerpProvider {
  readonly id: ProviderId;
  readonly engines: readonly SearchEngine[];
  checkRank(input: SerpRankCheck): Promise<SerpRankResult>;
}

// Configuration presence is NOT part of this contract: provider selection
// already knows it from providers.ts (async env reads cannot back a sync
// isConfigured in Workers). Adapters assume they were resolved deliberately.

export interface KeywordVolumeQuery {
  keyword: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  language: string;
  /** Provider-scoped region id; absent = national volume. */
  region?: string;
}

export interface KeywordVolumeRow {
  keyword: string;
  /** Monthly search volume; null = no data (never 0-as-missing). */
  volume: number | null;
  cpc: number | null;
  /** 0..1 normalized; null when the source has no competition concept. */
  competition: number | null;
  difficulty: number | null;
  /** 12-month search history when the source provides it. */
  monthly?: MonthlySearch[];
  source: "wordstat" | "dataforseo" | "google_ads" | "ahrefs";
}

export interface KeywordDataProvider {
  readonly id: ProviderId;
  getVolumes(queries: KeywordVolumeQuery[]): Promise<KeywordVolumeRow[]>;
}
