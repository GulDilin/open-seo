import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DataForSeoRequiredBadge,
  useSeoProviderSetup,
} from "@/client/components/ProviderRequiredBadge";
import { BacklinksPage } from "@/client/features/backlinks/BacklinksPage";
import {
  DEFAULT_BACKLINKS_PAGE_SIZE,
  backlinksSearchSchema,
} from "@/types/schemas/backlinks";
import { defaultScopeForInput } from "@/shared/researchScope";

export const Route = createFileRoute("/_app/p/$projectId/backlinks")({
  validateSearch: backlinksSearchSchema,
  component: BacklinksRoute,
});

function BacklinksRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const {
    target = "",
    scope: rawScope,
    tab = "backlinks",
    page = 1,
    size = DEFAULT_BACKLINKS_PAGE_SIZE,
    sort,
    order,
    view,
    includeSpam,
  } = Route.useSearch();
  const scope = rawScope ?? defaultScopeForInput(target);
  // The whole page runs on DataForSEO; without its key every mounted query
  // would fail server-side. Render the badge instead of the page.
  const setup = useSeoProviderSetup();
  if (setup.data && !setup.data.dataforseo)
    return (
      <div className="space-y-3">
        <DataForSeoRequiredBadge />
      </div>
    );

  return (
    <div className="space-y-3">
      <DataForSeoRequiredBadge />
      <BacklinksPage
        projectId={projectId}
        navigate={navigate}
        searchState={{
          target,
          scope,
          // Referring domains can't be filtered to a subfolder.
          tab: scope === "subfolder" && tab === "domains" ? "backlinks" : tab,
          page,
          pageSize: size,
          sort,
          order,
          view,
          includeSpam,
        }}
      />
    </div>
  );
}
