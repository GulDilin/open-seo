import { useQuery } from "@tanstack/react-query";
import { getProjectDomainRating } from "@/serverFunctions/domain";

/** Domain rating for the project's own website; rank stays null until known. */
export function useProjectDomainRating(projectId: string) {
  return useQuery({
    queryKey: ["project-domain-rating", projectId],
    queryFn: () => getProjectDomainRating({ data: { projectId } }),
    // The server refreshes at most once a day (snapshot) or per 6h cache
    // window; an hour keeps repeat visits off the query entirely.
    staleTime: 60 * 60_000,
  });
}
