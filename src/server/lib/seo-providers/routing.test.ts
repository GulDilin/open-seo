import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";
import { resolveSerpProvider } from "./routing";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSerpProvider", () => {
  it("routes google to serper when its key is set", async () => {
    vi.stubEnv("SERPER_API_KEY", "test-key");
    vi.stubEnv("DATAFORSEO_API_KEY", "also-set");
    await expect(resolveSerpProvider("google")).resolves.toBe("serper");
  });

  it("falls back to the incumbent for google without serper", async () => {
    vi.stubEnv("DATAFORSEO_API_KEY", "test-key");
    vi.stubEnv("SERPER_API_KEY", "");
    await expect(resolveSerpProvider("google")).resolves.toBe("dataforseo");
  });

  it("names both missing yandex credentials", async () => {
    await expect(resolveSerpProvider("yandex")).rejects.toSatisfy(
      (error) =>
        error instanceof AppError &&
        error.code === "UPSTREAM_UNAVAILABLE" &&
        error.message.includes("YANDEX_SEARCH_API_KEY") &&
        error.message.includes("YANDEX_FOLDER_ID"),
    );
  });

  it("keeps yandex unconfigured on a key without folder id", async () => {
    vi.stubEnv("YANDEX_SEARCH_API_KEY", "test-key");
    await expect(resolveSerpProvider("yandex")).rejects.toSatisfy(
      (error) =>
        error instanceof AppError && error.code === "UPSTREAM_UNAVAILABLE",
    );
  });

  it("resolves yandex with both credentials", async () => {
    vi.stubEnv("YANDEX_SEARCH_API_KEY", "test-key");
    vi.stubEnv("YANDEX_FOLDER_ID", "folder");
    await expect(resolveSerpProvider("yandex")).resolves.toBe("yandex");
  });

  it("names bright data for uncovered engines", async () => {
    await expect(resolveSerpProvider("baidu")).rejects.toSatisfy(
      (error) =>
        error instanceof AppError &&
        error.message.includes("BRIGHTDATA_API_TOKEN"),
    );
  });
});
