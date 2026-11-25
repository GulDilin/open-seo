import { createFileRoute } from "@tanstack/react-router";
import { WebmasterBacklinksSection } from "@/client/features/yandex/WebmasterBacklinksSection";

export const Route = createFileRoute("/_app/p/$projectId/yandex/backlinks")({
  component: YandexBacklinksRoute,
});

function YandexBacklinksRoute() {
  const { projectId } = Route.useParams();
  return <WebmasterBacklinksSection projectId={projectId} />;
}
