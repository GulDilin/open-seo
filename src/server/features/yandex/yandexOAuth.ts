import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { account } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { AppError } from "@/server/lib/errors";
import { responseForAppError } from "@/server/lib/http-errors";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { lookupYandexUid } from "@/server/lib/yandexWebmasterClient";
import {
  YANDEX_LINK_ERROR_PARAM,
  YANDEX_WEBMASTER_PROVIDER_ID,
  YANDEX_WEBMASTER_SCOPES,
} from "@/shared/yandex-webmaster";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";
import {
  consumeState,
  createState,
  getCodeChallenge,
  getCodeVerifier,
} from "@/server/features/google/googleOAuthState";

/**
 * Yandex Webmaster data grant, linked outside Better Auth's generic-oauth
 * plugin for the same reason as the Google grants in googleOAuth.ts: linked
 * accounts are login identities there, and one Yandex account must be
 * connectable by several OpenSEO users. The grant lives in the Better Auth
 * `account` table (providerId "yandex-webmaster", accountId = the Webmaster
 * uid), encrypted with the same secret. This module owns consent redirect,
 * callback, and refresh. Unlike Google, Yandex rotates the refresh token on
 * every refresh and lets it die together with the access token, so refresh
 * results are always persisted and a dead grant can only be fixed by
 * reconnecting.
 */

const YANDEX_AUTH_URL = "https://oauth.yandex.ru/authorize";
const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
const YANDEX_CALLBACK_PATH = "/api/yandex/oauth/callback";
// Refresh when the stored access token is within a day of expiry. Yandex
// tokens live for months, so this keeps routine use self-refreshing. A grant
// unused through its final day expires for good (Yandex kills the refresh
// token with it) and the user reconnects — a proactive renewal sweep is the
// upgrade path if that bites.
// ponytail: lazy refresh only; add a scheduled sweep if grants dying idle
// becomes a real support load.
const ACCESS_TOKEN_SKEW_MS = 24 * 60 * 60 * 1_000;

type YandexOAuthClientConfig = {
  clientId: string;
  clientSecret: string;
};

async function getYandexOAuthClientConfig(): Promise<YandexOAuthClientConfig | null> {
  const clientId = (
    await getOptionalEnvValue("YANDEX_OAUTH_CLIENT_ID")
  )?.trim();
  const clientSecret = (
    await getOptionalEnvValue("YANDEX_OAUTH_CLIENT_SECRET")
  )?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Yandex Webmaster needs an OAuth client plus the secret that encrypts
 *  stored tokens. */
export async function hasYandexOAuthConfig(): Promise<boolean> {
  const config = await getYandexOAuthClientConfig();
  if (!config) return false;
  const secret = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  return Boolean(secret && secret.length >= MIN_BETTER_AUTH_SECRET_LENGTH);
}

const yandexTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  // Only returned when fewer rights were granted than requested.
  scope: z.string().optional(),
});

type YandexTokenResponse = z.infer<typeof yandexTokenResponseSchema>;

/** Same-origin path check as the Google flow: the reduced path must still
 *  resolve to our origin. */
function getSafeCallbackPath(callbackURL: string, publicOrigin: string) {
  try {
    const url = new URL(callbackURL, publicOrigin);
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (url.origin !== publicOrigin) return "/";
    if (new URL(path, publicOrigin).origin !== publicOrigin) return "/";
    return path;
  } catch {
    return "/";
  }
}

/** Token encryption matches Better Auth's own `account` rows (shared helper
 *  with the Google grants). */
async function tokenCrypto() {
  const ctx = await getAuth().$context;
  const enabled = Boolean(ctx.options.account?.encryptOAuthTokens);
  return {
    encrypt: (value: string) =>
      enabled
        ? symmetricEncrypt({ key: ctx.secretConfig, data: value })
        : value,
    decrypt: (value: string) =>
      enabled
        ? symmetricDecrypt({ key: ctx.secretConfig, data: value })
        : value,
  };
}

async function upsertGrant(input: {
  userId: string;
  yandexUid: string;
  tokens: YandexTokenResponse;
}) {
  const { encrypt } = await tokenCrypto();
  const values = {
    accountId: input.yandexUid,
    providerId: YANDEX_WEBMASTER_PROVIDER_ID,
    userId: input.userId,
    accessToken: await encrypt(input.tokens.access_token),
    refreshToken: input.tokens.refresh_token
      ? await encrypt(input.tokens.refresh_token)
      : null,
    accessTokenExpiresAt: new Date(
      Date.now() + (input.tokens.expires_in ?? 3600) * 1_000,
    ),
    refreshTokenExpiresAt: null,
    scope: YANDEX_WEBMASTER_SCOPES.join(" "),
    password: null,
  };
  await db
    .insert(account)
    .values({
      id: crypto.randomUUID(),
      ...values,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [account.userId, account.providerId, account.accountId],
      // Matches the partial unique index that backs this conflict target.
      targetWhere: sql`${account.providerId} = 'yandex-webmaster'`,
      set: { ...values, updatedAt: new Date() },
    });
}

/** Yandex's token endpoint; null when it rejects the grant. */
async function fetchTokens(
  params: Record<string, string>,
): Promise<YandexTokenResponse | null> {
  const response = await fetch(YANDEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!response.ok) {
    // The response body carries Yandex's rejection reason (error_description)
    // — the only clue when a live exchange fails, so keep it in the logs.
    console.warn("yandex.oauth.token_rejected", {
      status: response.status,
      body: (await response.text().catch(() => "")).slice(0, 200),
    });
    return null;
  }
  return yandexTokenResponseSchema.parse(await response.json());
}

export async function createYandexAuthorizationUrl(input: {
  userId: string;
  callbackURL: string;
  publicOrigin: string;
}) {
  const config = await getYandexOAuthClientConfig();
  if (!config || !(await hasYandexOAuthConfig())) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      `Yandex Webmaster is not configured. Set YANDEX_OAUTH_CLIENT_ID, YANDEX_OAUTH_CLIENT_SECRET, and BETTER_AUTH_SECRET.`,
    );
  }
  const state = await createState({
    provider: YANDEX_WEBMASTER_PROVIDER_ID,
    userId: input.userId,
    callbackPath: getSafeCallbackPath(input.callbackURL, input.publicOrigin),
  });
  const url = new URL(YANDEX_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set(
    "redirect_uri",
    `${input.publicOrigin}${YANDEX_CALLBACK_PATH}`,
  );
  // Yandex separates scopes with spaces (code-url.md: "Значения в списке
  // разделяются пробелами"); a comma-joined string is one unknown scope and
  // the authorize call bounces back with invalid_scope.
  url.searchParams.set("scope", YANDEX_WEBMASTER_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set(
    "code_challenge",
    await getCodeChallenge(
      await getCodeVerifier({
        state,
        clientSecret: config.clientSecret,
        provider: YANDEX_WEBMASTER_PROVIDER_ID,
      }),
    ),
  );
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/** Yandex returns here after consent; failures bounce back to the page that
 *  started the connect with the Yandex link-error marker (mirrors Google). */
async function handleYandexOAuthCallback(input: {
  request: Request;
  userId: string;
  publicOrigin: string;
}) {
  const config = await getYandexOAuthClientConfig();
  if (!config) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Yandex OAuth is not configured.",
    );
  }
  const url = new URL(input.request.url);
  const rawState = url.searchParams.get("state");
  // Consumed before the user check so a state from the wrong session is
  // burned rather than left for a second attempt.
  const state = await consumeState({
    state: rawState,
    provider: YANDEX_WEBMASTER_PROVIDER_ID,
  });
  if (!rawState || !state || state.userId !== input.userId) {
    return redirect("/auth-error?error=state_mismatch");
  }
  const fail = (code: string) => {
    const back = new URL(state.callbackPath, input.publicOrigin);
    back.searchParams.set(YANDEX_LINK_ERROR_PARAM, "yandex");
    back.searchParams.set("error", code);
    return redirect(`${back.pathname}${back.search}${back.hash}`);
  };
  const yandexError = url.searchParams.get("error");
  if (yandexError) return fail(yandexError);
  const code = url.searchParams.get("code");
  if (!code) return fail("missing_code");
  let tokens: YandexTokenResponse | null;
  try {
    tokens = await fetchTokens({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      // The authorize URL sent code_challenge, so the exchange must present
      // the verifier (same HMAC of the state nonce as at consent time).
      code_verifier: await getCodeVerifier({
        state: rawState,
        clientSecret: config.clientSecret,
        provider: YANDEX_WEBMASTER_PROVIDER_ID,
      }),
    });
  } catch {
    return fail("oauth_code_verification_failed");
  }
  if (!tokens) return fail("oauth_code_verification_failed");
  // Yandex returns `scope` only when fewer rights were granted than requested.
  // webmaster:verify is what unlocks every data endpoint — a grant without it
  // 403s on all data, so send the user back instead of saving a dead grant.
  if (
    tokens.scope &&
    !tokens.scope.split(/[,\s]+/).includes("webmaster:verify")
  ) {
    return fail("scope_not_granted");
  }
  // The Webmaster uid keys the grant (Yandex's counterpart to Google's sub).
  let yandexUid: string;
  try {
    yandexUid = String(await lookupYandexUid(tokens.access_token));
  } catch {
    return fail("yandex_api_unavailable");
  }
  try {
    await upsertGrant({
      userId: input.userId,
      yandexUid,
      tokens,
    });
  } catch (error) {
    console.error("yandex.oauth.grant_save_failed", { error });
    return fail("connection_save_failed");
  }
  return redirect(state.callbackPath);
}

/**
 * A currently valid access token for the user's Yandex Webmaster grant,
 * refreshed against Yandex and re-persisted (access AND rotated refresh token)
 * when it is about to expire. `accountId` (the Webmaster uid) picks between
 * several grants.
 */
export async function getYandexWebmasterAccessToken(input: {
  userId: string;
  accountId?: string;
}): Promise<string> {
  const [grant] = await db
    .select({
      id: account.id,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
    })
    .from(account)
    .where(
      and(
        eq(account.userId, input.userId),
        eq(account.providerId, YANDEX_WEBMASTER_PROVIDER_ID),
        input.accountId ? eq(account.accountId, input.accountId) : undefined,
      ),
    )
    .limit(1);
  if (!grant) {
    throw new Error("No yandex-webmaster grant for this user.");
  }
  const { encrypt, decrypt } = await tokenCrypto();
  const expiresAt = grant.accessTokenExpiresAt?.getTime();
  if (
    expiresAt !== undefined &&
    expiresAt - Date.now() > ACCESS_TOKEN_SKEW_MS &&
    grant.accessToken
  ) {
    return decrypt(grant.accessToken);
  }
  if (!grant.refreshToken) {
    // Yandex refresh tokens die together with their access token, so a grant
    // without one cannot recover once it expires. Failing here lets clients
    // prompt for a reconnect instead of sending a dead token to Yandex.
    throw new Error(
      "The yandex-webmaster grant has expired and cannot be refreshed.",
    );
  }
  const config = await getYandexOAuthClientConfig();
  if (!config) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Yandex OAuth is not configured.",
    );
  }
  const tokens = await fetchTokens({
    grant_type: "refresh_token",
    refresh_token: await decrypt(grant.refreshToken),
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (!tokens) {
    throw new Error("Yandex refused to refresh the yandex-webmaster grant.");
  }
  await db
    .update(account)
    .set({
      accessToken: await encrypt(tokens.access_token),
      accessTokenExpiresAt: new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1_000,
      ),
      // Yandex rotates the refresh token on every refresh; keep the new one
      // and the old one only when Yandex omits it.
      ...(tokens.refresh_token
        ? { refreshToken: await encrypt(tokens.refresh_token) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(account.id, grant.id));
  return tokens.access_token;
}

export async function handleYandexOAuthCallbackRequest(request: Request) {
  try {
    const context = await resolveUserContextFromHeaders(request.headers);
    return await handleYandexOAuthCallback({
      request,
      userId: context.userId,
      publicOrigin: getPublicOrigin(request),
    });
  } catch (error) {
    // The browser is mid-redirect from Yandex, so an expired session or a
    // missing config should land on the error page, not a bare status body.
    if (error instanceof AppError) {
      return redirect(`/auth-error?error=${error.code.toLowerCase()}`);
    }
    return responseForAppError(error, "Yandex Webmaster OAuth failed");
  }
}
