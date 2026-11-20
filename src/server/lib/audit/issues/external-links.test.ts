import { describe, expect, it, vi } from "vitest";

import {
  externalLinkTargets,
  MAX_CHECKED_EXTERNAL_LINKS,
  runExternalLinkChecks,
} from "@/server/lib/audit/issues/external-links";
import type { PageLink } from "@/server/lib/audit/types";

const link = (targetUrl: string, isInternal = false): PageLink => ({
  targetUrl,
  anchor: null,
  isInternal,
  isNofollow: false,
});

const response = (status: number) => new Response(null, { status });

describe("externalLinkTargets", () => {
  it("keeps only external http(s) targets, capped per page", () => {
    expect(
      externalLinkTargets(
        [
          link("https://site.test/internal", true),
          link("https://partner.test/a"),
          link("https://partner.test/b"),
          link("javascript:void(0)"),
          link("http://127.0.0.1/admin"),
          link("https://partner.test/c"),
        ],
        2,
      ),
    ).toEqual(["https://partner.test/a", "https://partner.test/b"]);
  });
});

describe("runExternalLinkChecks", () => {
  it("reports a 404 and an unreachable target with source, URL and status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(404))
      .mockRejectedValueOnce(new Error("timed out"));
    vi.stubGlobal("fetch", fetchMock);

    const issues = await runExternalLinkChecks([
      {
        sourcePageId: "p1",
        sourceUrl: "https://site.test/",
        targetUrl: "https://partner.test/fine",
      },
      {
        sourcePageId: "p1",
        sourceUrl: "https://site.test/",
        targetUrl: "https://partner.test/gone",
      },
      {
        sourcePageId: "p2",
        sourceUrl: "https://site.test/about",
        targetUrl: "https://partner.test/hung",
      },
    ]);

    expect(issues).toEqual([
      {
        issueType: "broken-external-link",
        pageId: "p1",
        pageUrl: "https://site.test/",
        dedupeKey: "https://partner.test/gone",
        details: { targetUrl: "https://partner.test/gone", targetStatus: 404 },
      },
      {
        issueType: "broken-external-link",
        pageId: "p2",
        pageUrl: "https://site.test/about",
        dedupeKey: "https://partner.test/hung",
        details: {
          targetUrl: "https://partner.test/hung",
          targetStatus: "unreachable",
        },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("treats a redirect as a working link and probes a shared target once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(301));
    vi.stubGlobal("fetch", fetchMock);

    const issues = await runExternalLinkChecks([
      {
        sourcePageId: "p1",
        sourceUrl: "https://site.test/",
        targetUrl: "https://partner.test/moved",
      },
      {
        sourcePageId: "p2",
        sourceUrl: "https://site.test/about",
        targetUrl: "https://partner.test/moved",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(issues).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("probes at most MAX_CHECKED_EXTERNAL_LINKS unique targets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200));
    vi.stubGlobal("fetch", fetchMock);

    const edges = Array.from(
      { length: MAX_CHECKED_EXTERNAL_LINKS + 5 },
      (_, i) => ({
        sourcePageId: "p1",
        sourceUrl: "https://site.test/",
        targetUrl: `https://partner.test/link-${i}`,
      }),
    );

    await runExternalLinkChecks(edges);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_CHECKED_EXTERNAL_LINKS);
    vi.unstubAllGlobals();
  });

  it("never fetches a target the SSRF policy blocks, even if stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200));
    vi.stubGlobal("fetch", fetchMock);

    const issues = await runExternalLinkChecks([
      {
        sourcePageId: "p1",
        sourceUrl: "https://site.test/",
        targetUrl: "http://169.254.169.254/latest/meta-data",
      },
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(issues).toEqual([]);
    vi.unstubAllGlobals();
  });
});
