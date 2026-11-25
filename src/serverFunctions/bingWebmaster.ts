import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BingWebmasterNotConnectedError } from "@/server/lib/bingWebmasterErrors";
import {
  isExpectedAuthFailure,
  BingWebmasterService,
} from "@/server/features/bing/services/BingWebmasterService";
import {
  BING_DATE_RANGES,
  BING_QUERY_ORDERS,
} from "@/server/features/bing/bingSearchQueries";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
// The API key travels in the request that stores it and is never returned to
// the client afterwards.
const setSiteSchema = projectScopedSchema.extend({
  apiKey: z.string().min(1),
  siteUrl: z.string().min(1),
});
const performanceSchema = projectScopedSchema.extend({
  dateRange: z.enum(BING_DATE_RANGES).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  orderBy: z.enum(BING_QUERY_ORDERS).optional(),
});

export const getBingConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const connection = await BingWebmasterService.getConnection(
      context.projectId,
    );
    return {
      connected: Boolean(connection),
      canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
      siteUrl: connection?.siteUrl ?? null,
      connectedAt: connection?.createdAt ?? null,
    };
  });

/** Sites the API key can see — the key the user just typed, or the project's
 *  stored key when it is omitted (change-site flow). The key is validated here
 *  and only persisted by setBingSite. */
export const listBingSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema.extend({ apiKey: z.string().min(1).optional() }))
  .handler(async ({ data, context }) => {
    const [sites, connection] = await Promise.all([
      BingWebmasterService.listSites({
        projectId: context.projectId,
        apiKey: data.apiKey,
      }),
      BingWebmasterService.getConnection(context.projectId),
    ]);
    return {
      sites: sites.map((site) => ({
        siteUrl: site.siteUrl,
        verified: site.verified,
        isSelected: connection?.siteUrl === site.siteUrl,
      })),
    };
  });

export const setBingSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setSiteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const connection = await BingWebmasterService.setSite({
      projectId: context.projectId,
      organizationId: context.organizationId,
      apiKey: data.apiKey,
      siteUrl: data.siteUrl,
      userId: context.userId,
    });
    return {
      connected: true as const,
      siteUrl: connection.siteUrl,
      connectedAt: connection.createdAt,
    };
  });

export const disconnectBing = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await BingWebmasterService.disconnect({ projectId: context.projectId });
    return { connected: false as const };
  });

/** The Bing queries page payload. A rejected key resolves to
 *  { connected: false, unavailableReason } so the client renders the connect
 *  card instead of a hard error. */
export const getBingSearchPerformance = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(performanceSchema)
  .handler(async ({ data, context }) => {
    try {
      return {
        connected: true as const,
        ...(await BingWebmasterService.getSearchPerformance({
          projectId: context.projectId,
          dateRange: data.dateRange,
          startDate: data.startDate,
          endDate: data.endDate,
          orderBy: data.orderBy,
        })),
      };
    } catch (error) {
      if (error instanceof BingWebmasterNotConnectedError) {
        return { connected: false as const, unavailableReason: null };
      }
      if (isExpectedAuthFailure(error)) {
        const unavailableReason =
          error instanceof Error ? error.message : String(error);
        console.warn("bing.search_performance_unavailable", {
          projectId: context.projectId,
          reason: unavailableReason,
        });
        return { connected: false as const, unavailableReason };
      }
      throw error;
    }
  });

/** The Bing links page payload. Collect failures degrade inside the service —
 *  this only never-throw-wraps the unexpected. */
export const getBingLinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) =>
    BingWebmasterService.getLinks({ projectId: context.projectId }),
  );
