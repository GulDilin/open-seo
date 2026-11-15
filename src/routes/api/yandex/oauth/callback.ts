import { createFileRoute } from "@tanstack/react-router";
import { handleYandexOAuthCallbackRequest } from "@/server/features/yandex/yandexOAuth";

export const Route = createFileRoute("/api/yandex/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleYandexOAuthCallbackRequest(request),
    },
  },
});
