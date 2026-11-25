import { createFileRoute } from "@tanstack/react-router";
import { BingLinksSection } from "@/client/features/bing/BingLinksSection";

export const Route = createFileRoute("/_app/p/$projectId/bing/links")({
  component: BingLinksRoute,
});

function BingLinksRoute() {
  const { projectId } = Route.useParams();
  return <BingLinksSection projectId={projectId} />;
}
