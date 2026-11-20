import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createYandexWebmasterClient,
  YandexWebmasterApiError,
} from "./yandexWebmasterClient";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/server/features/yandex/yandexOAuth", () => ({
  getYandexWebmasterAccessToken: mocks.getAccessToken,
}));

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function urlOf(call: unknown) {
  return String(call);
}

// Fixtures embed the documented response examples (research.md §2, sources
// yandex.ru/dev/webmaster/doc/ru/reference/*). AT INTEGRATION: with live keys,
// replay the four endpoints and compare field-by-field.
describe("yandexWebmasterClient", () => {
  beforeEach(() => {
    mocks.getAccessToken.mockResolvedValue("yandex_tok_123");
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the OAuth scheme Yandex requires, not Bearer", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(jsonResponse({ hosts: [] }));
    const client = createYandexWebmasterClient({ userId: "u1" });
    await client.listHosts();

    // call 0 resolves the uid; call 1 is the hosts call under test.
    const [url, init] = mocks.fetch.mock.calls[1];
    expect(urlOf(url)).toBe(
      "https://api.webmaster.yandex.net/v4/user/111/hosts",
    );
    expect(init?.headers).toMatchObject({
      Authorization: "OAuth yandex_tok_123",
    });
  });

  it("resolves the uid once per client and reuses it in paths", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(jsonResponse({ hosts: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          sqi: 1,
          excluded_pages_count: 0,
          searchable_pages_count: 0,
        }),
      );
    const client = createYandexWebmasterClient({ userId: "u1" });
    await client.listHosts();
    await client.getSummary("https:ya.ru:80");

    const userCalls = mocks.fetch.mock.calls.filter(([url]) =>
      urlOf(url).endsWith("/v4/user"),
    );
    expect(userCalls).toHaveLength(1);
    // hosts call then the summary call, both under the cached uid.
    expect(urlOf(mocks.fetch.mock.calls[1][0])).toBe(
      "https://api.webmaster.yandex.net/v4/user/111/hosts",
    );
    expect(urlOf(mocks.fetch.mock.calls[2][0])).toContain(
      "/v4/user/111/hosts/https%3Aya.ru%3A80/summary",
    );
  });

  it("normalizes the documented hosts example", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(
        jsonResponse({
          hosts: [
            {
              host_id: "http:ya.ru:80",
              ascii_host_url: "http://ya.ru/",
              unicode_host_url: "http://ya.ru/",
              verified: true,
            },
          ],
        }),
      );
    const hosts = await createYandexWebmasterClient({
      userId: "u1",
    }).listHosts();

    expect(hosts).toEqual([
      {
        hostId: "http:ya.ru:80",
        asciiHostUrl: "http://ya.ru/",
        verified: true,
      },
    ]);
  });

  it("normalizes popular queries, tolerating absent indicators and a string count", async () => {
    // The docs type count as int32 but their own example serializes it as a
    // string; coerce both. An indicator may be absent when undefined.
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(
        jsonResponse({
          queries: [
            {
              query_id: "a08b",
              query_text: "some text",
              indicators: { TOTAL_SHOWS: 101.5, TOTAL_CLICKS: 3 },
            },
            {
              query_id: "c09d",
              query_text: "no positions",
              indicators: { TOTAL_SHOWS: 40 },
            },
          ],
          date_from: "2016-01-01T00:00:00,000+0300",
          date_to: "2016-01-07T00:00:00,000+0300",
          count: "300",
        }),
      );
    const result = await createYandexWebmasterClient({
      userId: "u1",
    }).getPopularQueries("https:ya.ru:80", {
      orderBy: "TOTAL_SHOWS",
      deviceType: "ALL",
      dateFrom: "2016-01-01",
      dateTo: "2016-01-07",
      limit: 500,
      offset: 0,
    });

    expect(result.rows).toEqual([
      {
        queryId: "a08b",
        query: "some text",
        impressions: 101.5,
        clicks: 3,
        avgShowPosition: null,
        avgClickPosition: null,
      },
      {
        queryId: "c09d",
        query: "no positions",
        impressions: 40,
        clicks: null,
        avgShowPosition: null,
        avgClickPosition: null,
      },
    ]);
    // Yandex clamps the window; callers must render these, not their request.
    expect(result.reportedDateFrom).toBe("2016-01-01");
    expect(result.reportedDateTo).toBe("2016-01-07");
    expect(result.totalCount).toBe(300);

    const [url] = mocks.fetch.mock.calls[1];
    expect(urlOf(url)).toContain("order_by=TOTAL_SHOWS");
    expect(urlOf(url)).toContain("device_type_indicator=ALL");
    // All four indicators are requested so missing ones come back as absent.
    expect(urlOf(url).match(/query_indicator=/g)).toHaveLength(4);
  });

  it("accepts a live-captured response, mapping JSON null indicators to null", async () => {
    // Live capture (falconspace.ru integration write-up): Yandex serializes
    // an undefined indicator as JSON null (zero-click query), not as an
    // absent key — `z.number().optional()` alone rejects this shape and the
    // whole tab's payload died on it.
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2791,
          queries: [
            {
              query_id: "4655b69c239b6462",
              query_text: "cms для маркетплейса",
              indicators: {
                TOTAL_SHOWS: 92,
                TOTAL_CLICKS: 8,
                AVG_SHOW_POSITION: 7.52,
                AVG_CLICK_POSITION: 6.375,
              },
            },
            {
              query_id: "dde486b6f18ac2c3",
              query_text: "манго офис коллтрекинг видео",
              indicators: {
                TOTAL_SHOWS: 2,
                TOTAL_CLICKS: 0,
                AVG_SHOW_POSITION: 13,
                AVG_CLICK_POSITION: null,
              },
            },
          ],
          date_from: "2026-10-19",
          date_to: "2026-11-15",
        }),
      );
    const result = await createYandexWebmasterClient({
      userId: "u1",
    }).getPopularQueries("https:ya.ru:80", {
      orderBy: "TOTAL_CLICKS",
      deviceType: "ALL",
      dateFrom: "2026-10-19",
      dateTo: "2026-11-15",
      limit: 500,
      offset: 0,
    });

    expect(result.rows[1]).toEqual({
      queryId: "dde486b6f18ac2c3",
      query: "манго офис коллтрекинг видео",
      impressions: 2,
      clicks: 0,
      avgShowPosition: 13,
      avgClickPosition: null,
    });
    expect(result.totalCount).toBe(2791);
  });

  it("accepts a summary with null values Yandex sends when they are undefined", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(
        jsonResponse({
          sqi: null,
          excluded_pages_count: null,
          searchable_pages_count: 42,
          site_problems: { FATAL: null, POSSIBLE_PROBLEM: 4 },
        }),
      );
    const summary = await createYandexWebmasterClient({
      userId: "u1",
    }).getSummary("https:ya.ru:80");

    expect(summary).toEqual({
      sqi: null,
      excludedPagesCount: null,
      searchablePagesCount: 42,
      problems: {
        fatal: null,
        critical: null,
        possibleProblem: 4,
        recommendation: null,
      },
    });
  });

  it("names the endpoint when the response shape drifts", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(jsonResponse({ queries: "not-an-array" }));
    await expect(
      createYandexWebmasterClient({ userId: "u1" }).getPopularQueries(
        "https:ya.ru:80",
        {
          orderBy: "TOTAL_SHOWS",
          deviceType: "ALL",
          dateFrom: "2016-01-01",
          dateTo: "2016-01-07",
          limit: 500,
          offset: 0,
        },
      ),
    ).rejects.toThrow(/unexpected response shape .*search-queries\/popular/);
  });

  it("normalizes the documented summary example", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(
        jsonResponse({
          sqi: 1,
          excluded_pages_count: 1,
          searchable_pages_count: 1,
          site_problems: { FATAL: 1, POSSIBLE_PROBLEM: 4 },
        }),
      );
    const summary = await createYandexWebmasterClient({
      userId: "u1",
    }).getSummary("https:ya.ru:80");

    expect(summary).toEqual({
      sqi: 1,
      excludedPagesCount: 1,
      searchablePagesCount: 1,
      problems: {
        fatal: 1,
        critical: null,
        possibleProblem: 4,
        recommendation: null,
      },
    });
  });

  it("reads SQI from the summary, tolerating a null value", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(jsonResponse({ sqi: 30 }))
      .mockResolvedValueOnce(jsonResponse({ sqi: null }));
    const client = createYandexWebmasterClient({ userId: "u1" });

    await expect(client.getSqi("https:ya.ru:80")).resolves.toBe(30);
    await expect(client.getSqi("https:ya.ru:80")).resolves.toBeNull();
    expect(urlOf(mocks.fetch.mock.calls[1][0])).toContain(
      "/v4/user/111/hosts/https%3Aya.ru%3A80/summary",
    );
  });

  it("surfaces Yandex's error_code for an unverified host", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValue(
        jsonResponse(
          {
            error_code: "HOST_NOT_VERIFIED",
            host_id: "https:ya.ru:80",
            error_message: "host not verified",
          },
          404,
        ),
      );
    await expect(
      createYandexWebmasterClient({ userId: "u1" }).getSummary(
        "https:ya.ru:80",
      ),
    ).rejects.toMatchObject({
      constructor: YandexWebmasterApiError,
      status: 404,
      errorCode: "HOST_NOT_VERIFIED",
    });
  });
});

describe("yandexWebmasterClient external links", () => {
  beforeEach(() => {
    mocks.getAccessToken.mockResolvedValue("yandex_tok_123");
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes link history, cutting datetime dates to days and coercing string values", async () => {
    // The docs type `value` as string but serialize it as a number in their
    // own example; accept both. Dates arrive as Yandex datetimes.
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(
        jsonResponse({
          indicators: {
            LINKS_TOTAL_COUNT: [
              { date: "2019-01-01T00:00:00,000+0300", value: 1 },
              { date: "2019-02-01T00:00:00,000+0300", value: "15" },
            ],
          },
        }),
      );
    const points = await createYandexWebmasterClient({
      userId: "u1",
    }).getExternalLinksHistory("https:ya.ru:80");

    expect(points).toEqual([
      { date: "2019-01-01", linksTotalCount: 1 },
      { date: "2019-02-01", linksTotalCount: 15 },
    ]);
    const [url] = mocks.fetch.mock.calls[1];
    expect(urlOf(url)).toBe(
      "https://api.webmaster.yandex.net/v4/user/111/hosts/https%3Aya.ru%3A80/links/external/history?indicator=LINKS_TOTAL_COUNT",
    );
  });

  it("normalizes external link samples with paging params and null-tolerant dates", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ user_id: 111 }))
      .mockResolvedValueOnce(
        jsonResponse({
          count: 12,
          links: [
            {
              source_url: "https://other-example.com/page/",
              destination_url: "https://example.com/page1/",
              discovery_date: "2019-01-01T00:00:00,000+0300",
              source_last_access_date: "2019-01-05",
            },
            {
              source_url: "https://no-dates.example.com/",
              destination_url: "https://example.com/",
            },
          ],
        }),
      );
    const result = await createYandexWebmasterClient({
      userId: "u1",
    }).getExternalLinksSamples("https:ya.ru:80", { limit: 100, offset: 200 });

    expect(result.count).toBe(12);
    expect(result.links).toEqual([
      {
        sourceUrl: "https://other-example.com/page/",
        destinationUrl: "https://example.com/page1/",
        discoveryDate: "2019-01-01",
        sourceLastAccessDate: "2019-01-05",
      },
      {
        sourceUrl: "https://no-dates.example.com/",
        destinationUrl: "https://example.com/",
        discoveryDate: null,
        sourceLastAccessDate: null,
      },
    ]);
    const [url] = mocks.fetch.mock.calls[1];
    expect(urlOf(url)).toBe(
      "https://api.webmaster.yandex.net/v4/user/111/hosts/https%3Aya.ru%3A80/links/external/samples?limit=100&offset=200",
    );
  });
});
