import { useQuery } from "@tanstack/react-query";
import { getProjectDomainRating } from "@/serverFunctions/domain";

/** Display names for the rating's sources, keyed by the service's `source`. */
export const DOMAIN_RATING_SOURCE_LABELS = {
  dataforseo: "DataForSEO",
  ahrefs: "Ahrefs",
} as const;

/**
 * Domain rating for the project's own website: rank plus the provider it came
 * from, or the reason it is empty (the UI shows that instead of a bare dash).
 */
export function useProjectDomainRating(projectId: string) {
  return useQuery({
    queryKey: ["project-domain-rating", projectId],
    queryFn: () => getProjectDomainRating({ data: { projectId } }),
    // The server refreshes at most once a day (snapshot) or per 6h cache
    // window; an hour keeps repeat visits off the query entirely.
    staleTime: 60 * 60_000,
  });
}
