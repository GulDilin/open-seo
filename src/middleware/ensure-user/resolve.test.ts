import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { AUTH_MODE: "oauth" },
  resolveHostedContext: vi.fn(),
  resolveLocalNoAuthContext: vi.fn(),
  resolveCloudflareAccessContext: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("./hosted", () => ({
  resolveHostedContext: mocks.resolveHostedContext,
}));
vi.mock("./delegated", () => ({
  resolveLocalNoAuthContext: mocks.resolveLocalNoAuthContext,
}));
vi.mock("./cloudflareAccess", () => ({
  resolveCloudflareAccessContext: mocks.resolveCloudflareAccessContext,
}));

import { resolveUserContextFromHeaders } from "./resolve";

describe("resolveUserContextFromHeaders", () => {
  it("dispatches oauth mode to the session resolver with the request headers", async () => {
    mocks.env.AUTH_MODE = "oauth";
    const headers = new Headers({ cookie: "session=x" });
    await resolveUserContextFromHeaders(headers);

    expect(mocks.resolveHostedContext).toHaveBeenCalledWith(headers);
    expect(mocks.resolveLocalNoAuthContext).not.toHaveBeenCalled();
  });

  it("keeps local_noauth on the local admin resolver", async () => {
    mocks.env.AUTH_MODE = "local_noauth";
    await resolveUserContextFromHeaders(new Headers());

    expect(mocks.resolveLocalNoAuthContext).toHaveBeenCalled();
    expect(mocks.resolveHostedContext).not.toHaveBeenCalled();
  });
});
