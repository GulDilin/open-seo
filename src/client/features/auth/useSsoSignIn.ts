import { useState } from "react";
import { captureClientEvent } from "@/client/lib/posthog";
import { authClient } from "@/lib/auth-client";
import { toAuthCallbackURL } from "@/lib/auth-redirect";
import { SSO_SIGNIN_PROVIDER_ID } from "@/shared/sso-signin";

// Starts the operator-configured OIDC sign-in flow (oauth mode, spec 016) —
// the genericOAuth client half of server/lib/ssoSignIn.ts.
export function useSsoSignIn({ redirectTo }: { redirectTo: string }) {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setIsStarting(true);
    try {
      captureClientEvent("auth:sign_in_sso_start", {
        redirect_to: redirectTo,
      });
      const result = await authClient.signIn.oauth2({
        providerId: SSO_SIGNIN_PROVIDER_ID,
        callbackURL: toAuthCallbackURL(redirectTo),
      });
      if (!result.error) return;
      setError(result.error.message || fallbackMessage);
    } catch {
      setError(fallbackMessage);
    }
    setIsStarting(false);
  }

  const fallbackMessage =
    "Sign-in is not available right now. Please try again.";

  return { isStarting, error, start };
}
