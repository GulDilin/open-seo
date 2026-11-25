import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@/lib/auth";

/** Encrypt/decrypt for app-managed secrets at rest — the Bing Webmaster API
 *  key today. Same scheme the Google/Yandex OAuth token helpers use (better-auth
 *  crypto keyed by the auth secret), on when `account.encryptOAuthTokens` is. */
export async function getSecretCrypto() {
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
