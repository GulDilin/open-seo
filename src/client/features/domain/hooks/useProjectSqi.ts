import { useQuery } from "@tanstack/react-query";
import { getProjectSqi } from "@/serverFunctions/domain";

/** Yandex SQI (ИКС) for the project's connected Webmaster site. */
export function useProjectSqi(projectId: string) {
  return useQuery({
    queryKey: ["project-sqi", projectId],
    queryFn: () => getProjectSqi({ data: { projectId } }),
    // The server caches in R2 for 24h; an hour keeps repeat visits off it.
    staleTime: 60 * 60_000,
    retry: false,
  });
}
