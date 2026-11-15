import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as yandexOAuthModule from "./yandexOAuth";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  getAuth: vi.fn(),
  resolveUserContextFromHeaders: vi.fn(),
  env: vi.fn<(name: string) => string | undefined>(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/middleware/ensure-user/resolve", () => ({
  resolveUserContextFromHeaders: mocks.resolveUserContextFromHeaders,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: mocks.env,
}));

// The state row and the grant upsert need real SQL (partial unique index,
// delete ... returning), so the module runs against a libsql file.
let client: Client;
let oauth: typeof yandexOAuthModule;
const directory = mkdtempSync(join(tmpdir(), "yandex-oauth-"));

function migrationStatements(file: string, include: (sql: string) => boolean) {
  return readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .filter(include)
    .join("\n");
}

beforeAll(async () => {
  client = createClient({ url: `file:${join(directory, "test.db")}` });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));
  // `account` references `user`; libsql enforces foreign keys by default.
  await client.executeMultiple(
    "CREATE TABLE user (id text PRIMARY KEY); INSERT INTO user VALUES ('user-1');",
  );
  await client.executeMultiple(
    migrationStatements(
      "drizzle/sqlite/0003_light_sage.sql",
      (sql) =>
        sql.includes("CREATE TABLE `account`") ||
        sql.includes("CREATE TABLE `verification`"),
    ),
  );
  // The partial unique index that backs the grant upsert — applied from the
  // real migrations (SQLite matches an ON CONFLICT target to a partial index
  // by its predicate, so the text must be identical).
  await client.executeMultiple(
    migrationStatements("drizzle/sqlite/0063_known_swarm.sql", () => true),
  );
  // One-time dynamic import: the module must bind to the mocked @/db above.
  oauth = await import("./yandexOAuth");
});

afterAll(() => {
  client.close();
  try {
    rmSync(directory, { recursive: true });
  } catch {
    // Windows keeps the libsql file locked briefly after close; a leftover
    // temp dir beats a red suite (the Google OAuth tests hit the same).
  }
});

const userId = "user-1";
const publicOrigin = "http://localhost:3001";
const callbackURL = `${publicOrigin}/p/project/settings/integrations`;

const ENV: Record<string, string> = {
  YANDEX_OAUTH_CLIENT_ID: "yandex-client-id",
  YANDEX_OAUTH_CLIENT_SECRET: "yandex-client-secret",
  BETTER_AUTH_SECRET: "x".repeat(40),
};

function tokenResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function driveCallback(params: Record<string, string>) {
  const url = await oauth.createYandexAuthorizationUrl({
    userId,
    callbackURL,
    publicOrigin,
  });
  const state = new URL(url).searchParams.get("state")!;
  const callback = new URL("/api/yandex/oauth/callback", publicOrigin);
  callback.searchParams.set("state", state);
  for (const [key, value] of Object.entries(params)) {
    callback.searchParams.set(key, value);
  }
  mocks.resolveUserContextFromHeaders.mockResolvedValue({ userId });
  return oauth.handleYandexOAuthCallbackRequest(new Request(callback));
}

async function grantRow() {
  const result = await client.execute(
    "SELECT account_id, access_token, refresh_token, access_token_expires_at FROM account LIMIT 1",
  );
  return result.rows[0] ?? null;
}

describe("Yandex Webmaster OAuth grants", () => {
  beforeEach(async () => {
    await client.executeMultiple(
      "DELETE FROM account; DELETE FROM verification;",
    );
    mocks.env.mockImplementation((name: string) => ENV[name]);
    mocks.getAuth.mockReturnValue({
      $context: Promise.resolve({
        options: { account: { encryptOAuthTokens: false } },
        secretConfig: "secret",
      }),
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges the code, resolves the uid, and persists the grant keyed by uid", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        tokenResponse({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 1000,
        }),
      )
      .mockResolvedValue(tokenResponse({ user_id: 111111 }));

    const response = await driveCallback({ code: "abc" });

    expect(response.status).toBe(303);
    expect(
      new URL(response.headers.get("Location")!, publicOrigin).pathname,
    ).toBe("/p/project/settings/integrations");
    // Token exchange posts the documented body params, including the PKCE
    // verifier matching the code_challenge sent at consent time.
    const [tokenUrl, tokenInit] = mocks.fetch.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth.yandex.ru/token");
    if (!(tokenInit?.body instanceof URLSearchParams)) {
      throw new Error("form body");
    }
    const body = tokenInit.body.toString();
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code_verifier=");
    const [uidUrl, uidInit] = mocks.fetch.mock.calls[1];
    expect(uidUrl).toBe("https://api.webmaster.yandex.net/v4/user");
    expect(uidInit?.headers).toMatchObject({ Authorization: "OAuth at-1" });
    expect(await grantRow()).toMatchObject({
      account_id: "111111",
      access_token: "at-1",
      refresh_token: "rt-1",
    });
  });

  it("space-separates scopes in the authorize URL (a comma reads as one unknown scope and Yandex answers invalid_scope)", async () => {
    const url = new URL(
      await oauth.createYandexAuthorizationUrl({
        userId,
        callbackURL,
        publicOrigin,
      }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "webmaster:hostinfo webmaster:verify",
    );
  });

  it("rejects a grant without webmaster:verify instead of saving a dead one", async () => {
    mocks.fetch.mockResolvedValueOnce(
      tokenResponse({
        access_token: "at-2",
        refresh_token: "rt-2",
        // Yandex returns scope only when fewer rights were granted.
        scope: "webmaster:hostinfo",
      }),
    );

    const response = await driveCallback({ code: "abc" });
    const back = new URL(response.headers.get("Location")!, publicOrigin);

    expect(back.searchParams.get("error")).toBe("scope_not_granted");
    expect(back.searchParams.get("yandex_link_error")).toBe("yandex");
    expect(await grantRow()).toBeNull();
  });

  it("rotates the refresh token when refreshing an expiring access token", async () => {
    await client.executeMultiple("DELETE FROM account;");
    mocks.fetch
      .mockResolvedValueOnce(
        tokenResponse({
          access_token: "at-old",
          refresh_token: "rt-1",
          // Already past the refresh skew.
          expires_in: -100_000,
        }),
      )
      .mockResolvedValue(tokenResponse({ user_id: 222 }));
    await driveCallback({ code: "first" });
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValueOnce(
      tokenResponse({
        access_token: "at-new",
        refresh_token: "rt-2",
        expires_in: 1000,
      }),
    );

    const token = await oauth.getYandexWebmasterAccessToken({ userId });

    expect(token).toBe("at-new");
    const [, refreshInit] = mocks.fetch.mock.calls[0];
    if (!(refreshInit?.body instanceof URLSearchParams)) {
      throw new Error("form body");
    }
    expect(refreshInit.body.toString()).toContain("grant_type=refresh_token");
    expect(refreshInit.body.toString()).toContain("refresh_token=rt-1");
    expect(await grantRow()).toMatchObject({
      access_token: "at-new",
      refresh_token: "rt-2",
    });
  });

  it("fails closed when the refresh token is gone (Yandex kills it with the access token)", async () => {
    await client.executeMultiple("DELETE FROM account;");
    mocks.fetch
      .mockResolvedValueOnce(
        tokenResponse({ access_token: "at-old", expires_in: -100_000 }),
      )
      .mockResolvedValue(tokenResponse({ user_id: 333 }));
    await driveCallback({ code: "second" });
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);

    await expect(
      oauth.getYandexWebmasterAccessToken({ userId }),
    ).rejects.toThrow(/cannot be refreshed/);
  });
});
