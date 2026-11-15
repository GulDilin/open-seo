import { createServerFn } from "@tanstack/react-start";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { getSeoProviderStatuses } from "@/server/lib/seo-providers/providers";

/**
 * Any configured SEO data provider satisfies setup — DataForSEO is optional
 * in this fork (serper/yandex/brightdata/googleads serve rank tracking and
 * volumes without it). The banner and setup modal show only when NO provider
 * has credentials.
 */
export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => {
    const statuses = await getSeoProviderStatuses();
    const configured = Object.values(statuses).some(Boolean);
    return { configured };
  });
