import { describe, expect, it } from "vitest";
import { runSelfhostPreflight } from "./selfhost-preflight";

function itemFor(
  result: ReturnType<typeof runSelfhostPreflight>,
  name: string,
) {
  return result.items.find((item) => item.name === name);
}

describe("runSelfhostPreflight", () => {
  it("passes the stock Docker setup (local_noauth + DataForSEO key)", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      DATAFORSEO_API_KEY: btoa("user@example.com:secret"),
    });

    expect(result.failed).toBe(false);
    expect(itemFor(result, "AUTH_MODE")?.level).toBe("ok");
    expect(itemFor(result, "DATAFORSEO_API_KEY")?.level).toBe("ok");
  });

  it("fails an invalid AUTH_MODE with the valid list", () => {
    const result = runSelfhostPreflight({ AUTH_MODE: "local-noauth" });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain(
      "cloudflare_access, local_noauth, hosted",
    );
  });

  it.each([
    [{}, ["TEAM_DOMAIN and POLICY_AUD", "AUTH_MODE is unset"]],
    [
      { AUTH_MODE: "hosted", BETTER_AUTH_SECRET: "x".repeat(40) },
      ["BETTER_AUTH_URL", "GOOGLE_CLIENT_ID"],
    ],
  ])("fails %o listing every missing variable", (env, mentions) => {
    const result = runSelfhostPreflight(env);

    expect(result.failed).toBe(true);
    const message = itemFor(result, "AUTH_MODE")?.message;
    for (const mention of mentions) expect(message).toContain(mention);
    expect(message).not.toContain("BETTER_AUTH_SECRET,");
  });

  it("warns that GSC stays disabled on a short BETTER_AUTH_SECRET", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      BETTER_AUTH_SECRET: "too-short",
    });

    expect(itemFor(result, "Search Console")?.level).toBe("warn");
    expect(itemFor(result, "Search Console")?.message).toContain("32");
  });

  it("reports Yandex Webmaster info when the OAuth client is unset", () => {
    const result = runSelfhostPreflight({ AUTH_MODE: "local_noauth" });

    expect(itemFor(result, "Yandex Webmaster (OAuth)")?.level).toBe("info");
    expect(itemFor(result, "Yandex Webmaster (OAuth)")?.message).toContain(
      "docs/SELF_HOSTING_YANDEX_WEBMASTER.md",
    );
  });

  it("warns when only one Yandex OAuth variable is set", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      YANDEX_OAUTH_CLIENT_ID: "id",
    });

    expect(itemFor(result, "Yandex Webmaster (OAuth)")?.level).toBe("warn");
    expect(itemFor(result, "Yandex Webmaster (OAuth)")?.message).toContain(
      "both are required",
    );
  });

  it("marks Yandex Webmaster configured when both variables and the secret exist", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      YANDEX_OAUTH_CLIENT_ID: "id",
      YANDEX_OAUTH_CLIENT_SECRET: "secret",
      BETTER_AUTH_SECRET: "x".repeat(40),
    });

    expect(itemFor(result, "Yandex Webmaster (OAuth)")?.level).toBe("ok");
  });

  it("reports alternative providers as unconfigured info, not failures", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      DATAFORSEO_API_KEY: btoa("user@example.com:secret"),
    });

    const item = itemFor(result, "SEO data providers");
    expect(item?.level).toBe("info");
    expect(item?.message).toContain("Serper (Google): not set");
    expect(item?.message).toContain("YANDEX_SEARCH_API_KEY + YANDEX_FOLDER_ID");
  });

  it("flips to ok and hides values when a provider key is set", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      SERPER_API_KEY: "secret-value",
    });

    const item = itemFor(result, "SEO data providers");
    expect(item?.level).toBe("ok");
    expect(item?.message).toContain("Serper (Google): set");
    expect(item?.message).not.toContain("secret-value");
  });

  const OAUTH_BASE = {
    AUTH_MODE: "oauth",
    BETTER_AUTH_URL: "https://seo.example.com",
    BETTER_AUTH_SECRET: "x".repeat(40),
    OAUTH_SIGNIN_ISSUER: "https://idp.example.com/realms/main",
    OAUTH_SIGNIN_CLIENT_ID: "id",
    OAUTH_SIGNIN_CLIENT_SECRET: "secret",
  } as const;

  it("passes oauth mode naming the configured OIDC issuer", () => {
    const result = runSelfhostPreflight({ ...OAUTH_BASE });

    expect(result.failed).toBe(false);
    const item = itemFor(result, "AUTH_MODE");
    expect(item?.level).toBe("ok");
    expect(item?.message).toContain(OAUTH_BASE.OAUTH_SIGNIN_ISSUER);
  });

  it("fails oauth mode listing every missing OIDC variable", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "oauth",
      BETTER_AUTH_URL: "https://seo.example.com",
      BETTER_AUTH_SECRET: "x".repeat(40),
    });

    expect(result.failed).toBe(true);
    const message = itemFor(result, "AUTH_MODE")?.message;
    expect(message).toContain("OAUTH_SIGNIN_ISSUER");
    expect(message).toContain("OAUTH_SIGNIN_CLIENT_ID");
    expect(message).toContain("OAUTH_SIGNIN_CLIENT_SECRET");
  });

  it("fails oauth mode naming the exact missing half of the client pair", () => {
    const result = runSelfhostPreflight({
      ...OAUTH_BASE,
      OAUTH_SIGNIN_CLIENT_SECRET: undefined,
    });

    expect(result.failed).toBe(true);
    const message = itemFor(result, "AUTH_MODE")?.message;
    expect(message).toContain("OAUTH_SIGNIN_CLIENT_SECRET");
    expect(message).not.toContain("OAUTH_SIGNIN_CLIENT_SECRET,");
  });

  it("fails oauth mode on a short BETTER_AUTH_SECRET", () => {
    const result = runSelfhostPreflight({
      ...OAUTH_BASE,
      BETTER_AUTH_SECRET: "too-short",
    });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain(
      "BETTER_AUTH_SECRET (at least 32 characters)",
    );
  });

  it("fails oauth mode on a non-https BETTER_AUTH_URL", () => {
    const result = runSelfhostPreflight({
      ...OAUTH_BASE,
      BETTER_AUTH_URL: "http://seo.example.com",
    });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain(
      "BETTER_AUTH_URL (must be https, or http://localhost)",
    );
  });

  it("fails oauth mode on a non-https OIDC issuer", () => {
    const result = runSelfhostPreflight({
      ...OAUTH_BASE,
      OAUTH_SIGNIN_ISSUER: "http://idp.example.com",
    });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain(
      "OAUTH_SIGNIN_ISSUER (must be https)",
    );
  });

  it("offers oauth as an alternative in the cloudflare_access failure hint", () => {
    const result = runSelfhostPreflight({});

    expect(itemFor(result, "AUTH_MODE")?.message).toContain("AUTH_MODE=oauth");
  });
});
