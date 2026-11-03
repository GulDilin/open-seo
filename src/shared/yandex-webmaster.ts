/** Better Auth providerId for the Yandex Webmaster data grant. Kept in
 *  `shared` so server (auth flow, API client) and client (connect card) can
 *  reference it without importing server-only modules. */
export const YANDEX_WEBMASTER_PROVIDER_ID = "yandex-webmaster";

/** Yandex Webmaster has exactly two API scopes. `webmaster:hostinfo` grants
 *  only the site list; every data endpoint (summary, search queries) returns
 *  403 without `webmaster:verify` — despite the name there is no read-only
 *  data scope, so the connect flow requests both. Comma-joined per Yandex
 *  OAuth (`scope=a,b`), unlike Google's space joining. */
export const YANDEX_WEBMASTER_SCOPES = [
  "webmaster:hostinfo",
  "webmaster:verify",
] as const;

export const YANDEX_SELF_HOSTED_SETUP_DOCS_URL =
  "https://github.com/every-app/open-seo/blob/main/docs/SELF_HOSTING_YANDEX_WEBMASTER.md";

/** Query param the Yandex OAuth callback appends next to `error` when it
 *  bounces a failed connect back to the starting page (mirrors the Google
 *  link-error marker). */
export const YANDEX_LINK_ERROR_PARAM = "yandex_link_error";
