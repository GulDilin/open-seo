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
