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
});
