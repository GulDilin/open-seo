import { createFileRoute } from "@tanstack/react-router";
import { BingSection } from "@/client/features/bing/BingSection";

export const Route = createFileRoute("/_app/p/$projectId/bing/")({
  component: BingPerformanceRoute,
});

function BingPerformanceRoute() {
  const { projectId } = Route.useParams();
  return <BingSection projectId={projectId} />;
}
