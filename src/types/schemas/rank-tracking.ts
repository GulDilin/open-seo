import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { rankTrackingConfigs } from "@/db/schema";
import { isSupportedLanguageCode } from "@/shared/keyword-locations";
import { searchEngineField } from "@/shared/search-engines";
import { MAX_TRACKED_KEYWORD_LENGTH } from "@/shared/rank-tracking";
import type {
  RankProjectSummary,
  RankProjectTrendPoint,
} from "@/shared/rank-tracking";
import { comparePeriodSchema } from "@/types/schemas/rank-tracking-search";
import { domainField } from "@/types/schemas/domain";
import { scheduleTimeSchema } from "@/types/schemas/schedule-time";

// ---------------------------------------------------------------------------
// DB-derived types
// ---------------------------------------------------------------------------

export type RankTrackingConfig = InferSelectModel<typeof rankTrackingConfigs>;

// ---------------------------------------------------------------------------
// API / UI types
// ---------------------------------------------------------------------------

export type RankCheckTriggerResult =
  | {
      ok: true;
      runId: string;
    }
  | {
      ok: false;
      reason: "already_running";
      blockingRunId: string | null;
    };

export interface RankTrackingDeviceResult {
  position: number | null;
  previousPosition: number | null;
  rankingUrl: string | null;
  serpFeatures: string[];
}

export interface RankTrackingRow {
  trackingKeywordId: string;
  keyword: string;
  matchCase: boolean;
  pinned: boolean;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  desktop: RankTrackingDeviceResult;
  mobile: RankTrackingDeviceResult;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

export type RankCheckScheduleTime = z.infer<typeof scheduleTimeSchema>;

const devicesEnum = z.enum(rankTrackingConfigs.devices.enumValues);
const scheduleEnum = z.enum(rankTrackingConfigs.scheduleInterval.enumValues);
// Rank tracking runs against the SERP API, which serves any language in any
// country — but an unknown code is a *charged* DataForSEO failure, so reject
// it here at cost 0.
const languageCodeField = z
  .string()
  .max(10)
  .refine(isSupportedLanguageCode, "Unsupported language code");

export const getConfigsSchema = z.object({
  projectId: z.string().uuid(),
});

export const getPanelKeywordSuggestionsSchema = z.object({
  projectId: z.string().uuid(),
  // Restricts suggestions to panels whose site covers this domain.
  domain: domainField.optional(),
  // A keyword tracked by a tracker on ANOTHER engine is still a suggestion
  // for this one — subtraction is engine-scoped when the engine is known.
  searchEngine: searchEngineField.optional(),
});

export const createConfigSchema = z.object({
  projectId: z.string().uuid(),
  domain: domainField,
  locationCode: z.number().int().positive().optional(),
  languageCode: languageCodeField.optional(),
  locationName: z.string().min(1).max(200).optional(),
  // Engine choice at create only — changing engines would orphan the position
  // history's meaning, so updates never carry it (a different engine is a new
  // tracker). Availability per market is checked in the service against the
  // resolved market, not here, because locationCode defaults live there.
  searchEngine: searchEngineField.optional(),
  devices: devicesEnum.optional(),
  serpDepth: z.number().int().min(10).max(100).multipleOf(10),
  scheduleInterval: scheduleEnum.optional(),
  scheduleTime: scheduleTimeSchema.optional(),
  // Opt-in: pull new keywords from the project's connected panels before
  // every scheduled check (capped; each keyword is a paid SERP call).
  autoKeywordImport: z.boolean().optional(),
});

export const updateConfigSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  domain: domainField.optional(),
  locationCode: z.number().int().positive().optional(),
  languageCode: languageCodeField.optional(),
  locationName: z.string().min(1).max(200).nullable().optional(),
  devices: devicesEnum.optional(),
  serpDepth: z.number().int().min(10).max(100).multipleOf(10).optional(),
  scheduleInterval: scheduleEnum.optional(),
  scheduleTime: scheduleTimeSchema.optional(),
  autoKeywordImport: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const triggerCheckSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).max(2000).optional(),
});

export const getLatestResultsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  comparePeriod: comparePeriodSchema.optional(),
});

export const getLatestRunSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

export const estimateCostSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

export const addKeywordsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywords: z
    .array(z.string().min(1).max(MAX_TRACKED_KEYWORD_LENGTH))
    .min(1)
    .max(2000),
  matchCase: z.boolean().optional(),
});

export const removeKeywordsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).min(1).max(2000),
});

export const setKeywordsPinnedSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).min(1).max(2000),
  pinned: z.boolean(),
});

export const refreshMetricsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

const deviceEnum = z.enum(["desktop", "mobile"]);
const sinceDaysField = z.number().int().positive().max(730).default(365);

export const getKeywordHistorySchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  trackingKeywordId: z.string().uuid(),
  sinceDays: sinceDaysField,
});

export const getConfigTrendSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  device: deviceEnum,
  sinceDays: sinceDaysField,
});

export const getProjectTrendSchema = z.object({
  projectId: z.string().uuid(),
  device: deviceEnum,
  sinceDays: sinceDaysField,
  searchEngine: searchEngineField.optional(),
  // locationName null = the national market; absent locationCode = any market.
  locationCode: z.number().int().positive().optional(),
  locationName: z.string().min(1).max(200).nullable().optional(),
});

/** The trend without its history window: current state only. */
export const getProjectSummarySchema = getProjectTrendSchema.omit({
  sinceDays: true,
});

export const getPositionMatrixSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  device: deviceEnum,
  runLimit: z.number().int().positive().max(26).default(12),
});

/** The domain overview's per-engine tracker summary: one call returns every
 * engine tracked on the project's own domain. */
export const getDomainTrackerSummarySchema = z.object({
  projectId: z.string().uuid(),
  device: deviceEnum,
  sinceDays: sinceDaysField,
});

// ---------------------------------------------------------------------------
// Domain tracker summary (domain overview page)
// ---------------------------------------------------------------------------

/** A ranking page of the project's domain: how many tracked queries land on
 *  it and the best of their current positions. */
export interface DomainTrackerTopPage {
  url: string;
  keywords: number;
  bestPosition: number;
}

export interface DomainTrackerEngineSummary {
  searchEngine: RankTrackingConfig["searchEngine"];
  summary: RankProjectSummary;
  trend: RankProjectTrendPoint[];
  topPages: DomainTrackerTopPage[];
}

/** Empty `engines` = no active tracker on the project's domain (the section
 *  stays hidden); engines with no snapshots render their own empty state. */
export interface DomainTrackerSummary {
  engines: DomainTrackerEngineSummary[];
}
