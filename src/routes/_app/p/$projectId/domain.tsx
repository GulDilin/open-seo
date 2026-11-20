import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { DomainOverviewPage } from "@/client/features/domain/DomainOverviewPage";
import {
  DataForSeoRequiredBadge,
  useSeoProviderSetup,
} from "@/client/components/ProviderRequiredBadge";
import {
  DEFAULT_DOMAIN_KEYWORDS_PAGE_SIZE,
  domainSearchSchema,
} from "@/types/schemas/domain";
import { getDomainRouteState } from "@/client/features/domain/domainRouteState";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { Card } from "@/client/components/ui/card";
import { ProjectDomainRatingCard } from "@/client/features/domain/components/ProjectDomainRatingCard";
import { ProjectSqiCard } from "@/client/features/domain/components/ProjectSqiCard";

const DEFAULT_DOMAIN_SEARCH = {
  domain: "",
  sort: "traffic",
  order: undefined,
  tab: "keywords",
  page: 1,
  size: DEFAULT_DOMAIN_KEYWORDS_PAGE_SIZE,
  include: "",
  exclude: "",
  minTraffic: undefined,
  maxTraffic: undefined,
  minVol: undefined,
  maxVol: undefined,
  minCpc: undefined,
  maxCpc: undefined,
  minKd: undefined,
  maxKd: undefined,
  minRank: undefined,
  maxRank: undefined,
  pInclude: "",
  pExclude: "",
  pMinTraffic: undefined,
  pMaxTraffic: undefined,
  pMinVol: undefined,
  pMaxVol: undefined,
} as const;

export const Route = createFileRoute("/_app/p/$projectId/domain")({
  validateSearch: domainSearchSchema,
  search: {
    middlewares: [stripSearchParams(DEFAULT_DOMAIN_SEARCH)],
  },
  component: DomainOverviewRoute,
});

function DomainOverviewRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const projectMarket = useProjectMarket(projectId);
  const routeState = getDomainRouteState(search, projectMarket);
  // Domain research (traffic, keywords, pages) runs on DataForSEO; without
  // its key every research query would fail server-side, so render the badge
  // instead of the research UI. The project's own site cards do not need
  // DataForSEO (SQI is first-party Webmaster data, the rating degrades to an
  // honest dash), so the page is never empty.
  const setup = useSeoProviderSetup();
  if (setup.data && !setup.data.dataforseo)
    return (
      <div className="space-y-3 px-4 py-4 md:px-6 md:py-6">
        <DataForSeoRequiredBadge />
        <Card className="gap-0 py-0">
          <div className="px-4 pt-4 pb-3">
            <h2 className="text-lg font-semibold">Your website</h2>
          </div>
          <div className="flex flex-wrap items-stretch gap-3 px-4 pb-4">
            <ProjectDomainRatingCard projectId={projectId} />
            <ProjectSqiCard projectId={projectId} />
          </div>
        </Card>
      </div>
    );

  return (
    <div className="space-y-3">
      <DataForSeoRequiredBadge />
      <DomainOverviewPage
        projectId={projectId}
        onShowRecentSearches={() => {
          void navigate({
            search: () => ({}),
            replace: true,
          });
        }}
        navigate={navigate}
        routeState={routeState}
      />
    </div>
  );
}
