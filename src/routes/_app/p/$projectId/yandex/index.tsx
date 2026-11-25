import { createFileRoute } from "@tanstack/react-router";
import { YandexSection } from "@/client/features/yandex/YandexSection";

export const Route = createFileRoute("/_app/p/$projectId/yandex/")({
  component: YandexPerformanceRoute,
});

function YandexPerformanceRoute() {
  const { projectId } = Route.useParams();
  return <YandexSection projectId={projectId} />;
}
