/** The operator-configured OIDC sign-in provider for AUTH_MODE=oauth
 *  (spec 016). Kept in `shared` so the server plugin (ssoSignIn.ts) and the
 *  client hook (useSsoSignIn.ts) reference one id — it is also the callback
 *  path segment: <origin>/api/auth/oauth2/callback/sso. */
export const SSO_SIGNIN_PROVIDER_ID = "sso";

/** Default scopes when OAUTH_SIGNIN_SCOPES is unset — the OIDC standard set
 *  every conformant IdP accepts. */
export const DEFAULT_SSO_SIGNIN_SCOPES = ["openid", "profile", "email"];
