import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { startYandexLink as startYandexLinkFn } from "@/serverFunctions/yandexWebmaster";

// One link flow at a time: a double-click would start two consent screens for
// one return page (same reasoning as startGoogleLink.ts).
let linkRedirectPending = false;

/**
 * Kick off the Yandex Webmaster OAuth grant. On success this redirects the
 * whole page to Yandex's consent screen; `callbackURL` is where Yandex returns
 * the user afterward. Failures during the round-trip come back to the same
 * page with the yandex_link_error marker that YandexConnectionCard surfaces.
 */
export async function startYandexLink(
  callbackURL: string,
  resumeKey: string,
): Promise<boolean> {
  if (linkRedirectPending) return false;
  linkRedirectPending = true;
  let redirecting = false;
  try {
    try {
      sessionStorage.setItem(resumeKey, "open");
    } catch {
      /* Yandex authorization does not require browser storage. */
    }
    const { url } = await startYandexLinkFn({ data: { callbackURL } });
    redirecting = true;
    window.location.href = url;
    setTimeout(() => {
      linkRedirectPending = false;
    }, 15_000);
    return true;
  } catch (error) {
    toast.error(getStandardErrorMessage(error));
    try {
      sessionStorage.removeItem(resumeKey);
    } catch {
      /* Storage is optional. */
    }
    return false;
  } finally {
    if (!redirecting) linkRedirectPending = false;
  }
}

/** Restore the site picker after Yandex's full-page redirect, scoped to this
 *  project (mirrors useGooglePickerResume). */
export function useYandexPickerResume(projectId: string) {
  // null lets the card derive unfinished setup from the saved authorization;
  // false means the user explicitly closed the picker during this visit.
  const [picking, setPicking] = useState<boolean | null>(null);
  const key = `yandex-site-picker:${projectId}`;
  useEffect(() => {
    setPicking(null);
    try {
      if (sessionStorage.getItem(key)) {
        sessionStorage.removeItem(key);
        setPicking(true);
      }
    } catch {
      /* Storage can be disabled; Connect still opens the picker. */
    }
  }, [key]);
  return { picking, setPicking, resumeKey: key };
}
