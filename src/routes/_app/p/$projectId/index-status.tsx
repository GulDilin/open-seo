import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { IndexStatusPage } from "@/client/features/index-status/IndexStatusPage";
import {
  DEFAULT_INDEX_STATUS_PAGE_SIZE,
  indexStatusSearchSchema,
} from "@/types/schemas/index-status";

export const Route = createFileRoute("/_app/p/$projectId/index-status")({
  validateSearch: indexStatusSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({
        problemsOnly: false,
        page: 1,
        size: DEFAULT_INDEX_STATUS_PAGE_SIZE,
      }),
    ],
  },
  component: IndexStatusRoute,
});

function IndexStatusRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  return (
    <IndexStatusPage
      projectId={projectId}
      search={search}
      onSearchChange={(update) => {
        void navigate({
          search: (prev) => ({ ...prev, ...update }),
          replace: true,
        });
      }}
    />
  );
}
