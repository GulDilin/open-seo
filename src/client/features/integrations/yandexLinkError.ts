import { YANDEX_LINK_ERROR_PARAM } from "@/shared/yandex-webmaster";

/**
 * Read and scrub the Yandex link-error params synchronously at module init —
 * same reasoning as googleLinkError.ts: route loaders can redirect the URL
 * before any effect runs. __root.tsx calls captureYandexLinkError() at module
 * scope so the capture stays in the entry chunk.
 */
function captureLinkErrorFromLocation(): { code: string } | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const marker = url.searchParams.get(YANDEX_LINK_ERROR_PARAM);
  if (marker !== "yandex") return null;
  const code = url.searchParams.get("error") ?? "unknown";
  url.searchParams.delete(YANDEX_LINK_ERROR_PARAM);
  url.searchParams.delete("error");
  window.history.replaceState(window.history.state, "", url);
  return { code };
}

let captured: { code: string } | null = null;
let didCapture = false;

/** Idempotent; the first call (from __root's module scope) wins. */
export function captureYandexLinkError() {
  if (didCapture) return;
  didCapture = true;
  captured = captureLinkErrorFromLocation();
}

/** The captured Yandex link failure, if any survived the redirect. */
export function getYandexLinkError(): { code: string } | null {
  captureYandexLinkError();
  return captured;
}

/** Called on dismiss so SPA navigation doesn't resurrect the alert. */
export function clearYandexLinkError() {
  captured = null;
}
