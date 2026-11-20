import { beforeEach, describe, expect, it, vi } from "vitest";
import { yandexWebSearch } from "./client";

const envMocks = vi.hoisted(() => ({
  getRequiredEnvValue: vi.fn(),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: envMocks.getRequiredEnvValue,
}));

/** A Search API response wrapping the XML in the documented rawData envelope. */
function rawDataResponse(xml: string) {
  return new Response(JSON.stringify({ rawData: btoa(xml) }), { status: 200 });
}

const OK_XML = `<?xml version="1.0"?>
<yandexsearch version="1.0"><response><results><grouping>
<group><doc id="Z1A2B3"><url>https://ozon.ru/category/sneaky/</url><domain>ozon.ru</domain><title>Sneaky on Ozon</title></doc>
</grouping></results></response></yandexsearch>`;

beforeEach(() => {
  envMocks.getRequiredEnvValue.mockResolvedValue("test-key");
});

describe("yandexWebSearch", () => {
  it("decodes rawData and returns the live-shape docs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(rawDataResponse(OK_XML));
    vi.stubGlobal("fetch", fetchMock);

    const docs = await yandexWebSearch({ keyword: "sneaky" });
    vi.unstubAllGlobals();

    expect(docs).toEqual([
      {
        url: "https://ozon.ru/category/sneaky/",
        domain: "ozon.ru",
        title: "Sneaky on Ozon",
      },
    ]);
  });

  it("throws the in-XML error instead of reading it as zero results", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        rawDataResponse(
          `<response><error code="33">Search limit exceeded</error></response>`,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(yandexWebSearch({ keyword: "sneaky" })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Yandex Search API error 33: Search limit exceeded",
    });
    vi.unstubAllGlobals();
  });

  it("treats the nothing-found error code as an empty result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        rawDataResponse(
          `<response><error code="15">No results for this query</error></response>`,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(yandexWebSearch({ keyword: "sneaky" })).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});
