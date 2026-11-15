import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { z } from "zod";
import {
  DEFAULT_SSO_SIGNIN_SCOPES,
  SSO_SIGNIN_PROVIDER_ID,
} from "@/shared/sso-signin";

/**
 * The sign-in provider for AUTH_MODE=oauth (spec 016, amended 2026-11-03:
 * one operator-configured OpenID Connect IdP instead of hardcoded
 * Google/Yandex). The operator supplies the issuer; authorization, token,
 * and userinfo endpoints come from the IdP's
 * /.well-known/openid-configuration document at runtime (better-auth
 * genericOAuth discovery).
 *
 * Contract pinned from the installed better-auth@1.6.22 (dist/plugins/
 * generic-oauth/routes.mjs), not from memory:
 * - discovery supplies authorization_endpoint, token_endpoint, and
 *   userinfo_endpoint; the issuer is validated against the discovery
 *   document's own `issuer` claim.
 * - the plugin decodes the id_token when present, else fetches userinfo with
 *   `Authorization: Bearer`, and REJECTS the sign-in itself when the profile
 *   has no subject id (`sub`/`id`) or no email.
 * - mapProfileToUser below only fills the display-name gap: better-auth
 *   rejects a profile with no name (name_is_missing), so the email — the
 *   account key — doubles as the last-resort name for terse IdPs.
 */

const ssoProfileSchema = z
  .object({
    name: z.string().nullish(),
    preferred_username: z.string().nullish(),
    username: z.string().nullish(),
    login: z.string().nullish(),
    email: z.string().nullish(),
  })
  .passthrough();

/** Fills the display-name gap in the IdP profile; the plugin handles the
 *  subject-id and email requirements. */
function mapSsoProfileToUser(profile: unknown) {
  const parsed = ssoProfileSchema.safeParse(profile);
  if (!parsed.success) return {};
  const name =
    parsed.data.name ??
    parsed.data.preferred_username ??
    parsed.data.username ??
    parsed.data.login ??
    parsed.data.email;
  return {
    ...(name ? { name } : {}),
    // Always verified: oauth mode has no email-verification lane (it is
    // disabled in auth.ts), so an IdP's email_verified:false would strand
    // the user on /verify-email with no way through. The operator chose
    // this IdP; its identity is the account source, same trust as Google.
    emailVerified: true,
  };
}

export function createSsoSignInProviderConfig(input: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes?: string;
}): GenericOAuthConfig {
  const issuer = input.issuer.replace(/\/+$/, "");
  return {
    providerId: SSO_SIGNIN_PROVIDER_ID,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    scopes: input.scopes?.trim()
      ? input.scopes.trim().split(/\s+/)
      : DEFAULT_SSO_SIGNIN_SCOPES,
    mapProfileToUser: mapSsoProfileToUser,
  };
}
