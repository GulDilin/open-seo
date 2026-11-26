import { beforeEach, describe, expect, it, vi } from "vitest";

const kvStore = new Map<string, string>();
const workersEnv = vi.hoisted(
  () =>
    ({ AHREFS_API_KEY: "ahrefs-key-1" }) as {
      AHREFS_API_KEY?: string;
    },
);
// What the Ahrefs module actually sent, captured inside the typed mock so the
// test reads real request data instead of poking at mock.call internals.
const sent = vi.hoisted(() => ({ url: "", auth: null as string | null }));

vi.mock("cloudflare:workers", () => ({
  env: {
    KV: {
      get: (key: string) => Promise.resolve(kvStore.get(key) ?? null),
      put: (key: string, value: string) =>
        Promise.resolve(kvStore.set(key, value)),
    },
    get AHREFS_API_KEY() {
      return workersEnv.AHREFS_API_KEY;
    },
  },
}));
vi.stubGlobal(
  "fetch",
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    sent.url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    sent.auth = new Headers(init?.headers).get("Authorization");
    return Promise.resolve(
      new Response(JSON.stringify({ domain_rating: { domain_rating: 55 } })),
    );
  }),
);

import { getAhrefsDomainRating } from "./ahrefs";

beforeEach(() => {
  kvStore.clear();
  sent.url = "";
  sent.auth = null;
});

describe("getAhrefsDomainRating", () => {
  it("sends the stored APIv3 key as a Bearer token", async () => {
    const dr = await getAhrefsDomainRating("example.com");
    expect(dr).toBe(55);
    expect(new URL(sent.url).searchParams.get("target")).toBe("example.com");
    expect(sent.auth).toBe("Bearer ahrefs-key-1");
  });

  it("reports a DR of 0 as a real rating and caches it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ domain_rating: { domain_rating: 0 } })),
        ),
      ),
    );
    expect(await getAhrefsDomainRating("unknown.example")).toBe(0);
    expect(kvStore.get("ahrefs-dr:unknown.example")).toBe("0");
    // A second read is served from the cache, not the API.
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ domain_rating: { domain_rating: 1 } })),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getAhrefsDomainRating("unknown.example")).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads legacy cached 'null' entries (the old DR 0 mapping) as 0", async () => {
    kvStore.set("ahrefs-dr:legacy.example", "null");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getAhrefsDomainRating("legacy.example")).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("names the missing key instead of calling Ahrefs without auth", async () => {
    const hadKey = workersEnv.AHREFS_API_KEY;
    delete workersEnv.AHREFS_API_KEY;
    try {
      await expect(getAhrefsDomainRating("example.com")).rejects.toThrow(
        "AHREFS_API_KEY",
      );
    } finally {
      workersEnv.AHREFS_API_KEY = hadKey;
    }
  });
});
