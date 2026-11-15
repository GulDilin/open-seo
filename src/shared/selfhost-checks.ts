// Pure validators for self-host configuration values. Shared by the runtime
// (auth middleware, /api/health, telemetry) and the Docker preflight script,
// so every surface applies the exact same rules and wording.

export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;

// BETTER_AUTH_URL rule (auth.ts's hostedBaseUrlSchema applies the same one):
// URL-parsed, https anywhere or http only on localhost. Substring checks
// would accept "http://localhost.evil.com" and a bare "https://".
export function isHttpsOrLocalhostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

// OIDC issuers (OAUTH_SIGNIN_ISSUER) are always https.
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

type TeamDomainResult =
  | { ok: true; origin: string }
  | { ok: false; message: string };

export function validateTeamDomain(value: string): TeamDomainResult {
  const normalized = value.trim().replace(/\/+$/, "");

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "https:") {
      throw new Error("TEAM_DOMAIN must use https");
    }

    return { ok: true, origin: parsed.origin };
  } catch {
    return {
      ok: false,
      message:
        "TEAM_DOMAIN must be a full https URL like https://your-team.cloudflareaccess.com" +
        (normalized && !normalized.includes("://")
          ? ` — add the https:// prefix to "${normalized}"`
          : ""),
    };
  }
}

// DATAFORSEO_API_KEY is NOT the key shown in the DataForSEO dashboard — it is
// base64("login:password"). Decoding it and finding a colon is a cheap sanity
// check that catches the most common paste mistake without a paid API call.
export function looksLikeDataForSeoKey(value: string): boolean {
  try {
    return atob(value.trim()).includes(":");
  } catch {
    return false;
  }
}

// OPENSEO_TELEMETRY_DISABLED / DO_NOT_TRACK semantics: any value except an
// explicit "off" string disables telemetry (fail toward privacy), but
// "0"/"false"/"no"/"off" mean what the operator wrote — telemetry stays on.
export function isTelemetryOptOutValue(
  value: string | undefined | null,
): boolean {
  if (!value) return false;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
