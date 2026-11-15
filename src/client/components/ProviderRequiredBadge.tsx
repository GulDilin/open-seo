import { useQuery } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { getSeoProviderSetup } from "@/serverFunctions/seo-providers";

/** Shared provider-credential status query (one request across every badge
 *  and gated card — same queryKey, so the cache dedupes them). */
export function useSeoProviderSetup() {
  return useQuery({
    queryKey: ["seo-provider-setup"],
    queryFn: () => getSeoProviderSetup(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Shown on surfaces whose data still comes from DataForSEO: when the key is
 * absent the page cannot load its data, so say so up front instead of
 * letting every request fail with an upstream error. Rendered only when the
 * badge applies — callers gate it with the `when` prop.
 */
export function DataForSeoRequiredBadge({ when = true }: { when?: boolean }) {
  const setup = useSeoProviderSetup();
  if (!when || setup.isLoading || setup.data?.dataforseo) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      <PlugZap className="size-4 shrink-0" aria-hidden />
      <span>
        This section needs the DataForSEO key (DATAFORSEO_API_KEY). Ask your
        operator to set it — or ask about the Serper/Yandex/Bright Data
        providers that already cover rank tracking.
      </span>
    </div>
  );
}
