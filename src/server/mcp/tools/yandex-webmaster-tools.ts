import { z } from "zod";
import { yandexWebmasterSchema } from "@/shared/mcp-contracts";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import {
  formatMcpTable,
  percentCell,
  positionCell,
  type McpTableColumn,
} from "@/server/mcp/table";
import { projectIdSchema } from "@/server/mcp/schemas";
import { hasYandexOAuthConfig } from "@/server/features/yandex/yandexOAuth";
import { YandexWebmasterService } from "@/server/features/yandex/services/YandexWebmasterService";
import {
  YANDEX_DATE_RANGES,
  YANDEX_DEFAULT_ROWS,
  YANDEX_DEVICE_TYPES,
  YANDEX_MAX_ROWS,
  YANDEX_QUERY_ORDERS,
} from "@/server/features/yandex/yandexSearchQueries";
import {
  YandexWebmasterApiError,
  YandexWebmasterNotConnectedError,
  YandexWebmasterTokenError,
} from "@/server/lib/yandexWebmasterErrors";
import { YANDEX_SELF_HOSTED_SETUP_DOCS_URL } from "@/shared/yandex-webmaster";
import type { YandexQueryRow } from "@/server/lib/yandexWebmasterClient";

type ProjectAuthContext = {
  auth: { organizationId: string };
  baseUrl: string;
};

// Honest notes about what Yandex does not report; embedded in every response
// so the model states the limits instead of presenting floors as totals.
const YANDEX_LIMITATIONS = [
  "Rows come from Yandex's popular-queries pool, capped at 3000 queries; treat totals as floors, not exhaustive counts.",
  "No query-to-page join and no previous-period comparison exist for this endpoint.",
  "CTR is derived (clicks/impressions); Yandex does not report it.",
  "Positions are Yandex averages and are not comparable to Google's.",
];

type ToolRow = YandexQueryRow & { ctr: number | null };

const QUERY_COLUMNS: McpTableColumn<ToolRow>[] = [
  { header: "query", value: (row) => row.query },
  { header: "impressions", value: (row) => row.impressions },
  { header: "clicks", value: (row) => row.clicks },
  { header: "CTR", value: (row) => row.ctr, format: percentCell },
  {
    header: "avg show pos",
    value: (row) => row.avgShowPosition,
    format: positionCell,
  },
  {
    header: "avg click pos",
    value: (row) => row.avgClickPosition,
    format: positionCell,
  },
];

function withCtr(row: YandexQueryRow): ToolRow {
  const ctr =
    row.clicks !== null && row.impressions !== null && row.impressions > 0
      ? row.clicks / row.impressions
      : null;
  return { ...row, ctr };
}

const inputSchema = {
  projectId: projectIdSchema,
  dateRange: z
    .enum(YANDEX_DATE_RANGES)
    .optional()
    .describe(
      "Convenience window (default last_28_days). The end is set 4 days back for Yandex's data finalization lag. Ignored if startDate+endDate are given.",
    ),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Explicit window start (YYYY-MM-DD). Use with endDate."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Explicit window end (YYYY-MM-DD). Use with startDate."),
  orderBy: z
    .enum(YANDEX_QUERY_ORDERS)
    .optional()
    .describe(
      "Sort metric (default clicks). Rows are the top queries BY this metric — Yandex caps the pool at 3000, so an impressions-ordered top-50 differs from filtering a clicks-ordered one.",
    ),
  deviceType: z
    .enum(YANDEX_DEVICE_TYPES)
    .optional()
    .describe("Device split (default all)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(YANDEX_MAX_ROWS)
    .optional()
    .describe(
      `Rows returned (default ${YANDEX_DEFAULT_ROWS}, max ${YANDEX_MAX_ROWS} — fetched as up to two 500-row pages ordered by the chosen metric).`,
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getYandexSearchPerformanceTool = {
  name: "get_yandex_search_performance",
  config: {
    title: "Get Yandex Webmaster search performance",
    description:
      "Read the connected Yandex Webmaster site's popular search queries — impressions, clicks, derived CTR, average show/click position for a period and device — plus the site summary (Yandex quality index, pages in search, excluded pages, problem counts, indexing status). First-party Yandex data for what a site already ranks for in Yandex Search; use it when the audience is in Russia or CIS. Rows are Yandex's popular-queries pool (capped at 3000, 500 per request): totals are floors, there is no query-page join and no previous-period series, and CTR is derived — the response lists these limitations. The window shown is what Yandex actually returned (it may end earlier than requested; data finalizes ~4 days late). Reads only the Yandex Webmaster site already connected to an OpenSEO project the caller is authorized to access. Read-only; uses no credits.",
    inputSchema,
    outputSchema: yandexWebmasterSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: Args, context: ProjectAuthContext) => {
      // Self-hosted deployments need a Yandex OAuth client; surface the setup
      // nudge before attempting a token lookup.
      if (!(await hasYandexOAuthConfig())) {
        const meta = buildProjectMeta(context, args.projectId);
        return mcpResponse({
          text: `This self-hosted OpenSEO deployment is not configured for Yandex Webmaster yet. Set YANDEX_OAUTH_CLIENT_ID, YANDEX_OAUTH_CLIENT_SECRET, and BETTER_AUTH_SECRET, then reconnect Yandex Webmaster from the project's settings page. Setup docs: ${YANDEX_SELF_HOSTED_SETUP_DOCS_URL}`,
          meta,
          structuredContent: {
            ok: false,
            reason: "yandex_oauth_not_configured",
            setupDocsUrl: YANDEX_SELF_HOSTED_SETUP_DOCS_URL,
          },
        });
      }

      const connectUrl = `${context.baseUrl}/p/${args.projectId}/search-performance`;
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/search-performance`,
      );

      // A half-specified explicit window would silently fall back to a default.
      if (Boolean(args.startDate) !== Boolean(args.endDate)) {
        return mcpResponse({
          text: "Provide both startDate and endDate, or neither (use dateRange instead).",
          meta,
          structuredContent: { ok: false, reason: "invalid_request" },
        });
      }

      try {
        const result = await YandexWebmasterService.getSearchPerformance({
          projectId: args.projectId,
          dateRange: args.dateRange,
          startDate: args.startDate,
          endDate: args.endDate,
          orderBy: args.orderBy,
          deviceType: args.deviceType,
          limit: args.limit,
        });
        const rows = result.rows
          .map(withCtr)
          .slice(0, args.limit ?? YANDEX_DEFAULT_ROWS);
        const header =
          `${result.hostUrl} · ${result.reportedDateFrom}→${result.reportedDateTo} (as reported by Yandex) · ` +
          `${rows.length} of ${result.totalCount} available queries · ordered by ${result.orderBy} · ${result.deviceType}`;
        const summaryLines = result.summary
          ? [
              `SQI: ${result.summary.sqi ?? "unreported"}`,
              `pages in search: ${result.summary.searchablePagesCount ?? "unreported"}`,
              `excluded pages: ${result.summary.excludedPagesCount ?? "unreported"}`,
              `indexing status: ${result.indexingStatus ?? "unreported"}`,
              `problems — fatal: ${result.summary.problems.fatal ?? 0}, critical: ${result.summary.problems.critical ?? 0}, possible: ${result.summary.problems.possibleProblem ?? 0}, recommendations: ${result.summary.problems.recommendation ?? 0}`,
            ]
          : [
              "Site summary unavailable (Yandex has not loaded this site's data yet).",
            ];
        const text =
          `${header}\n\n${formatMcpTable(rows, QUERY_COLUMNS)}\n\n` +
          `Summary\n${summaryLines.map((line) => `- ${line}`).join("\n")}\n\n` +
          `Limitations\n${YANDEX_LIMITATIONS.map((line) => `- ${line}`).join("\n")}`;

        return mcpResponse({
          text:
            rows.length > 0
              ? text
              : `${header}\nNo query data for this window.`,
          meta,
          structuredContent: {
            ok: true,
            hostUrl: result.hostUrl,
            reportedDateFrom: result.reportedDateFrom,
            reportedDateTo: result.reportedDateTo,
            orderBy: result.orderBy,
            deviceType: result.deviceType,
            totalCount: result.totalCount,
            rowCount: rows.length,
            rows,
            summary: result.summary
              ? { ...result.summary, indexingStatus: result.indexingStatus }
              : undefined,
            limitations: YANDEX_LIMITATIONS,
          },
        });
      } catch (error) {
        const isNotConnected =
          error instanceof YandexWebmasterNotConnectedError;
        return mcpResponse({
          text: isNotConnected
            ? `Yandex Webmaster is not connected for this project. Connect it here: ${connectUrl}`
            : error instanceof YandexWebmasterTokenError
              ? `The Yandex Webmaster connection has expired or was revoked. Reconnect it at ${connectUrl}.`
              : error instanceof YandexWebmasterApiError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : String(error),
          meta,
          structuredContent: {
            ok: false,
            reason: isNotConnected
              ? "not_connected"
              : error instanceof YandexWebmasterTokenError
                ? "needs_reconnect"
                : "api_error",
            connectionRequired:
              isNotConnected || error instanceof YandexWebmasterTokenError,
            connectUrl,
          },
        });
      }
    },
  ),
};
