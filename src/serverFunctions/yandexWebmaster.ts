import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  createYandexAuthorizationUrl,
  hasYandexOAuthConfig,
} from "@/server/features/yandex/yandexOAuth";
import {
  isExpectedGrantFailure,
  YandexWebmasterService,
  YandexWebmasterNotConnectedError,
} from "@/server/features/yandex/services/YandexWebmasterService";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";
import {
  YANDEX_DATE_RANGES,
  YANDEX_DEVICE_TYPES,
  YANDEX_QUERY_ORDERS,
} from "@/server/features/yandex/yandexSearchQueries";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const setSiteSchema = projectScopedSchema.extend({
  accountId: z.string().min(1),
  hostId: z.string().min(1),
});
const startLinkSchema = z.object({
  callbackURL: z.string().min(1),
});
const performanceSchema = projectScopedSchema.extend({
  dateRange: z.enum(YANDEX_DATE_RANGES).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  orderBy: z.enum(YANDEX_QUERY_ORDERS).optional(),
  deviceType: z.enum(YANDEX_DEVICE_TYPES).optional(),
});

export const getYandexConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [connection, currentUserHasGrant, yandexOAuthConfigured] =
      await Promise.all([
        YandexWebmasterService.getConnection(context.projectId),
        YandexWebmasterService.userHasGrant(context.userId),
        hasYandexOAuthConfig(),
      ]);
    return {
      connected: Boolean(connection),
      canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
      currentUserHasGrant,
      yandexOAuthConfigured,
      hostUrl: connection?.hostUrl ?? null,
      connectedAt: connection?.createdAt ?? null,
    };
  });

export const listYandexSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [siteList, connection] = await Promise.all([
      YandexWebmasterService.listSitesForUserWithGrantStatus(context.userId),
      YandexWebmasterService.getConnection(context.projectId),
    ]);
    return {
      accounts: siteList.accounts.map((grant) => ({
        accountId: grant.accountId,
        requiresReconnect: grant.requiresReconnect,
        sitesUnavailable: grant.sitesUnavailable,
        sites: grant.sites.map((site) => ({
          hostId: site.hostId,
          hostUrl: site.asciiHostUrl,
          verified: site.verified,
          isSelected:
            connection?.yandexAccountId === grant.accountId &&
            connection?.hostId === site.hostId,
        })),
      })),
    };
  });

export const setYandexSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setSiteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const connection = await YandexWebmasterService.setSite({
      projectId: context.projectId,
      organizationId: context.organizationId,
      accountId: data.accountId,
      hostId: data.hostId,
      userId: context.userId,
    });
    return {
      connected: true as const,
      hostUrl: connection.hostUrl,
      connectedAt: connection.createdAt,
    };
  });

export const disconnectYandex = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await YandexWebmasterService.disconnect({ projectId: context.projectId });
    return { connected: false as const };
  });

export const startYandexLink = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(startLinkSchema)
  .handler(async ({ data, context }) => ({
    url: await createYandexAuthorizationUrl({
      userId: context.userId,
      callbackURL: data.callbackURL,
      publicOrigin: getPublicOrigin(getRequest()),
    }),
  }));

/** The Yandex tab payload. Expected connection failures (not connected, dead
 *  grant) resolve to { connected: false } so the client renders the connect
 *  card instead of a hard error. */
export const getYandexSearchPerformance = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(performanceSchema)
  .handler(async ({ data, context }) => {
    try {
      return {
        connected: true as const,
        ...(await YandexWebmasterService.getSearchPerformance({
          projectId: context.projectId,
          dateRange: data.dateRange,
          startDate: data.startDate,
          endDate: data.endDate,
          orderBy: data.orderBy,
          deviceType: data.deviceType,
        })),
      };
    } catch (error) {
      if (
        error instanceof YandexWebmasterNotConnectedError ||
        isExpectedGrantFailure(error)
      ) {
        // The connect card shows "Connected" while data loads fall here —
        // without this line the reason (dead grant vs 401/403) is invisible.
        console.warn("yandex.search_performance_unavailable", {
          projectId: context.projectId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return { connected: false as const };
      }
      throw error;
    }
  });
