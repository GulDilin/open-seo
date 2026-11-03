import * as React from "react";
import { Button } from "@/client/components/ui/button";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import {
  clearYandexLinkError,
  getYandexLinkError,
} from "@/client/features/integrations/yandexLinkError";

const ERROR_COPY: Record<string, { title: string; description: string }> = {
  access_denied: {
    title: "Yandex connection canceled",
    description:
      "You declined the permissions in Yandex. Try again to connect.",
  },
  scope_not_granted: {
    title: "Yandex permissions incomplete",
    description:
      "The grant is missing webmaster:verify, which Yandex requires for all data endpoints (there is no read-only alternative). Reconnect and keep both permissions checked.",
  },
  oauth_code_verification_failed: {
    title: "Yandex authorization failed",
    description:
      "The code from Yandex could not be exchanged. Please retry the connect.",
  },
  yandex_api_unavailable: {
    title: "Yandex Webmaster unavailable",
    description:
      "The token was issued but Yandex Webmaster did not accept it. Retry in a moment.",
  },
  connection_save_failed: {
    title: "Could not save the connection",
    description:
      "Yandex authorized the app, but saving the grant failed. Please retry.",
  },
};

/** Inline error shown on a connect surface after a failed Yandex link flow
 *  (the Yandex sibling of GoogleLinkErrorAlert). */
export function YandexLinkErrorAlert() {
  const [error] = React.useState(() => getYandexLinkError());
  const [dismissed, setDismissed] = React.useState(false);
  if (!error || dismissed) return null;
  const copy = ERROR_COPY[error.code] ?? {
    title: "Yandex connection failed",
    description: `The connect flow failed (${error.code}). Please retry.`,
  };
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.description}</AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          onClick={() => {
            clearYandexLinkError();
            setDismissed(true);
          }}
        >
          ✕
        </Button>
      </AlertAction>
    </Alert>
  );
}
