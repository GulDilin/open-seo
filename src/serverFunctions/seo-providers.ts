import { createServerFn } from "@tanstack/react-start";
import { getSeoProviderStatuses } from "@/server/lib/seo-providers/providers";

/**
 * Provider presence for UI surfaces: pages whose data still needs the
 * incumbent key show an explanatory badge instead of a raw API error.
 */
export const getSeoProviderSetup = createServerFn({ method: "POST" }).handler(
  async () => getSeoProviderStatuses(),
);
