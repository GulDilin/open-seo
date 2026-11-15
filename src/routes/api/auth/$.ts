import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { getAuth, hasSessionAuthConfig } from "@/lib/auth";
import { isSessionAuthMode } from "@/lib/auth-mode";

// Serves the Better Auth HTTP API for every session-auth mode (hosted and
// self-hosted oauth, spec 016): sign-in, OAuth callbacks, get-session,
// sign-out, and the API-key endpoints behind Settings → Personal.
async function handleAuthRequest(request: Request) {
  if (!isSessionAuthMode(env.AUTH_MODE)) {
    return new Response("Not found", {
      status: 404,
    });
  }

  if (!hasSessionAuthConfig()) {
    return new Response("Missing Better Auth configuration for session auth", {
      status: 500,
    });
  }

  const auth = getAuth();
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        return handleAuthRequest(request);
      },
      POST: async ({ request }: { request: Request }) => {
        return handleAuthRequest(request);
      },
    },
  },
});
