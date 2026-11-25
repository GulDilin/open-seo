import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/p/$projectId/yandex")({
  component: YandexLayout,
});

function YandexLayout() {
  const { projectId } = Route.useParams();
  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      {/* Remount on a project switch so page-level filter state resets with it. */}
      <div className="mx-auto max-w-7xl space-y-4" key={projectId}>
        <div>
          <h1 className="text-2xl font-semibold">Yandex Webmaster</h1>
          <p className="text-sm text-muted-foreground">
            Search queries and external links reported by Yandex Webmaster for
            your site.
          </p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
