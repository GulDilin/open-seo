import { describe, expect, it } from "vitest";
import { DEFAULT_SSO_SIGNIN_SCOPES } from "@/shared/sso-signin";
import { createSsoSignInProviderConfig } from "./ssoSignIn";

function mapProfile(profile: unknown) {
  const { mapProfileToUser } = createSsoSignInProviderConfig({
    issuer: "https://idp.example.com",
    clientId: "id",
    clientSecret: "secret",
  });
  // The plugin's published signature is Record<string, any>; the mapper
  // itself guards unknown shapes at runtime (the non-object test relies on
  // that), so the string case below is intentionally out of the type.
  if (!mapProfileToUser) throw new Error("mapProfileToUser must be set");
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- bridging better-auth's looser published param type to the mapper's unknown-guarding runtime contract
  return mapProfileToUser(profile as Record<string, unknown>);
}

describe("mapProfileToUser", () => {
  it("keeps the IdP's own name", () => {
    expect(mapProfile({ name: "Ivan", email: "ivan@example.com" })).toEqual({
      name: "Ivan",
      emailVerified: true,
    });
  });

  it("falls back to username-style fields, then the email, when the IdP sends no name", () => {
    expect(mapProfile({ preferred_username: "ivan" })).toEqual({
      name: "ivan",
      emailVerified: true,
    });
    // Terse IdPs return only sub + email; better-auth would reject a
    // name-less profile with name_is_missing, so the email is the name.
    expect(mapProfile({ sub: "42", email: "ivan@example.com" })).toEqual({
      name: "ivan@example.com",
      emailVerified: true,
    });
  });

  it("treats an unverified IdP email as verified — oauth mode has no verification lane", () => {
    expect(
      mapProfile({
        name: "Ivan",
        email: "ivan@example.com",
        email_verified: false,
      }),
    ).toEqual({ name: "Ivan", emailVerified: true });
  });

  it("returns an empty mapping for a non-object profile", () => {
    expect(mapProfile("nope")).toEqual({});
  });
});

describe("createSsoSignInProviderConfig", () => {
  it("builds the discovery URL from the issuer, tolerating trailing slashes", () => {
    const config = createSsoSignInProviderConfig({
      issuer: "https://idp.example.com/realms/main/",
      clientId: "id",
      clientSecret: "secret",
    });

    expect(config.discoveryUrl).toBe(
      "https://idp.example.com/realms/main/.well-known/openid-configuration",
    );
    expect(config.scopes).toEqual(DEFAULT_SSO_SIGNIN_SCOPES);
  });

  it("splits a custom scope string on whitespace", () => {
    const config = createSsoSignInProviderConfig({
      issuer: "https://idp.example.com",
      clientId: "id",
      clientSecret: "secret",
      scopes: "openid email  custom:thing",
    });

    expect(config.scopes).toEqual(["openid", "email", "custom:thing"]);
  });
});
