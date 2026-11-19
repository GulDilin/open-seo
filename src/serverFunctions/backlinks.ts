import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import { WebmasterBacklinksService } from "@/server/features/backlinks/services/WebmasterBacklinksService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  backlinksOverviewInputSchema,
  backlinksRowsPageRequestSchema,
  referringDomainsPageRequestSchema,
  topPagesPageRequestSchema,
} from "@/types/schemas/backlinks";

// Referring-domain scores aggregate multiple links and retain their own filters.
const WEB_SPAM_OPTIONS = { hideSpam: false };

export const getBacklinksOverview = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(backlinksOverviewInputSchema)
  .handler(async ({ data, context }) => {
    const profile = await BacklinksService.profileOverview(
      {
        target: data.target,
        scope: data.scope,
      },
      context,
    );
    return profile.overview;
  });

export const getBacklinksRows = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(backlinksRowsPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileBacklinksPage(data, context, {
      hideSpam: data.hideSpam ?? true,
    }),
  );

export const getBacklinksReferringDomains = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(referringDomainsPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileReferringDomainsPage(
      data,
      context,
      WEB_SPAM_OPTIONS,
    ),
  );

export const getBacklinksTopPages = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(topPagesPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileTopPagesPage(data, context),
  );

/** The webmaster section of the Backlinks page. Collects from connected
 *  webmasters when stored data is stale, then returns stored link data plus
 *  per-source connection state (GSC is reported connected-but-API-limited
 *  rather than as zero links). */
export const getWebmasterBacklinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ context }) =>
    WebmasterBacklinksService.getBacklinks({ projectId: context.projectId }),
  );
