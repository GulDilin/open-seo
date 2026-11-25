import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBingWebmasterClient,
  BingWebmasterApiError,
} from "./bingWebmasterClient";

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function urlOf(call: unknown) {
  return String(call);
}

// Fixtures embed the documented response examples (learn.microsoft.com
// /dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.* — each
// method page carries a JSON request/response sample). AT INTEGRATION: with a
// live key, replay the four endpoints and compare field-by-field.
describe("bingWebmasterClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the API key as the query parameter Bing authenticates with", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        d: [
          {
            __type: "Site:#Microsoft.Bing.Webmaster.Api",
            IsVerified: true,
            Url: "http://example.com/",
          },
        ],
      }),
    );
    const sites = await createBingWebmasterClient({
      apiKey: "bing_key_1",
    }).getUserSites();

    expect(sites).toEqual([{ siteUrl: "http://example.com/", verified: true }]);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(urlOf(url)).toBe(
      "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=bing_key_1",
    );
    expect(init?.headers).toMatchObject({ Accept: "application/json" });
  });

  it("normalizes the documented GetQueryStats example, cutting the WCF date to its bucket day", async () => {
    // The docs' /Date(1316156400000-0700)/ is 2011-09-16T00:00-07:00 — the raw
    // epoch cuts to the same day here, but a +03:00 account would not, so the
    // offset is applied (covered by the next fixture).
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        d: [
          {
            __type: "QueryStats:#Microsoft.Bing.Webmaster.Api",
            AvgClickPosition: 18,
            AvgImpressionPosition: 17,
            Clicks: 15,
            Date: "/Date(1316156400000-0700)/",
            Impressions: 100,
            Query: "query",
          },
        ],
      }),
    );
    const stats = await createBingWebmasterClient({ apiKey: "k" }).getQueryStats(
      "http://example.com/",
    );

    expect(stats).toEqual({
      rows: [
        {
          date: "2011-09-16",
          query: "query",
          impressions: 100,
          clicks: 15,
          avgImpressionPosition: 17,
          avgClickPosition: 18,
        },
      ],
      reportedDateFrom: "2011-09-16",
      reportedDateTo: "2011-09-16",
    });
    const [url] = mocks.fetch.mock.calls[0];
    expect(urlOf(url)).toBe(
      "https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=http%3A%2F%2Fexample.com%2F&apikey=k",
    );
  });

  it("shifts a WCF date with a positive offset onto the day Bing means", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        d: [
          {
            // 2011-09-16T00:00+03:00 — the raw epoch instant is the 15th UTC.
            Date: "/Date(1316148000000+0300)/",
            Query: "query",
            Clicks: 0,
            Impressions: 0,
          },
        ],
      }),
    );
    const stats = await createBingWebmasterClient({ apiKey: "k" }).getQueryStats(
      "http://example.com/",
    );
    expect(stats.rows[0].date).toBe("2011-09-16");
  });

  it("normalizes the documented GetLinkCounts and GetUrlLinks examples", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          d: {
            __type: "LinkCounts:#Microsoft.Bing.Webmaster.Api",
            Links: [
              {
                __type: "LinkCount:#Microsoft.Bing.Webmaster.Api",
                Count: 14,
                Url: "http://example.com/page1.html",
              },
            ],
            TotalPages: 3,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          d: {
            __type: "LinkDetails:#Microsoft.Bing.Webmaster.Api",
            Details: [
              {
                __type: "LinkDetail:#Microsoft.Bing.Webmaster.Api",
                AnchorText: "link",
                Url: "http://example.com/page1.html",
              },
            ],
            TotalPages: 3,
          },
        }),
      );
    const client = createBingWebmasterClient({ apiKey: "k" });

    expect(await client.getLinkCounts("http://example.com/", 0)).toEqual({
      links: [{ url: "http://example.com/page1.html", count: 14 }],
      totalPages: 3,
    });
    expect(
      await client.getUrlLinks("http://example.com/", "http://example.com/x", 0),
    ).toEqual({
      details: [
        { sourceUrl: "http://example.com/page1.html", anchorText: "link" },
      ],
      totalPages: 3,
    });

    const [countsUrl, linksUrl] = mocks.fetch.mock.calls.map(([u]) => urlOf(u));
    expect(countsUrl).toBe(
      "https://ssl.bing.com/webmaster/api.svc/json/GetLinkCounts?siteUrl=http%3A%2F%2Fexample.com%2F&page=0&apikey=k",
    );
    expect(linksUrl).toContain(
      "https://ssl.bing.com/webmaster/api.svc/json/GetUrlLinks?siteUrl=http%3A%2F%2Fexample.com%2F&link=http%3A%2F%2Fexample.com%2Fx&page=0&apikey=k",
    );
  });

  it("surfaces Bing's ErrorCode/Message body for a rejected key", async () => {
    // Documented error response: HTTP 400 {"ErrorCode":3,"Message":"InvalidApiKey"}.
    mocks.fetch.mockResolvedValue(
      jsonResponse({ ErrorCode: 3, Message: "InvalidApiKey" }, 400),
    );
    await expect(
      createBingWebmasterClient({ apiKey: "bad" }).getUserSites(),
    ).rejects.toMatchObject({
      constructor: BingWebmasterApiError,
      status: 400,
      errorCode: 3,
      message: "Bing Webmaster API error (400): InvalidApiKey",
    });
  });

  it("treats an HTTP 200 ErrorCode body without the d payload as an error", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ ErrorCode: 4, Message: "InvalidSiteUrl" }),
    );
    await expect(
      createBingWebmasterClient({ apiKey: "k" }).getLinkCounts(
        "http://example.com/",
        0,
      ),
    ).rejects.toMatchObject({
      constructor: BingWebmasterApiError,
      status: 200,
      errorCode: 4,
    });
  });

  it("names the method when the response shape drifts", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ d: { Links: "nope" } }));
    await expect(
      createBingWebmasterClient({ apiKey: "k" }).getLinkCounts(
        "http://example.com/",
        0,
      ),
    ).rejects.toThrow(/unexpected response shape for GetLinkCounts/);
  });

  it("reports no buckets when Bing returns an empty d", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ d: [] }));
    const stats = await createBingWebmasterClient({ apiKey: "k" }).getQueryStats(
      "http://example.com/",
    );
    expect(stats).toEqual({
      rows: [],
      reportedDateFrom: null,
      reportedDateTo: null,
    });
  });
});
