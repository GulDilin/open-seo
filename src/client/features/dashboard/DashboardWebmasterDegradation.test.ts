import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

// Only the server functions are stubbed; the widgets run for real against
// query data seeded into the cache.
vi.mock("@/serverFunctions/dashboard", () => ({
  getDashboardBacklinks: vi.fn(),
  getDashboardLinkActivity: vi.fn(),
  getDashboardWebmasterLinks: vi.fn(),
}));
vi.mock("@/serverFunctions/seo-providers", () => ({
  getSeoProviderSetup: vi.fn(),
}));
// The widgets link out of themselves; static rendering has no router context.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: (props: { children?: ReactNode }) =>
    createElement("a", null, props.children),
}));

import { DashboardBacklinks } from "./DashboardBacklinks";
import { DashboardLinkActivity } from "./DashboardLinkActivity";

const yandexRow = {
  source: "yandex_webmaster",
  domainFrom: "referring.example",
  urlFrom: "https://referring.example/page",
  urlTo: "https://site.example/",
  anchor: null,
  isDofollow: null,
  domainFromRank: null,
  spamScore: null,
  firstSeen: "2026-11-18",
  lastSeen: "2026-11-18",
};
const connectedYandex = {
  connected: true,
  unavailableReason: null,
  collectError: null,
  yandex: [yandexRow],
};
const deadGrantYandex = {
  connected: false,
  unavailableReason: "Could not mint a Yandex Webmaster token",
  collectError: null,
  yandex: [],
};

function renderWidget(
  component: (props: { projectId: string; domain: string }) => ReactNode,
  setup: { dataforseo: boolean },
  webmasterLinks: unknown,
) {
  const client = new QueryClient();
  client.setQueryData(["seo-provider-setup"], setup);
  client.setQueryData(["dashboardWebmasterLinks", "p1"], webmasterLinks);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(component, { projectId: "p1", domain: "site.example" }),
    ),
  );
  client.clear();
  return load(html).text();
}

const noKey = { dataforseo: false };

it("shows Yandex Webmaster samples instead of a badge when the DataForSEO key is missing", () => {
  const text = renderWidget(DashboardBacklinks, noKey, connectedYandex);
  expect(text).toContain("referring.example");
  expect(text).toContain("2026-11-18");
  expect(text).not.toContain("DATAFORSEO_API_KEY");
});

it("shows the card's Yandex samples without a badge under the same condition", () => {
  const text = renderWidget(DashboardLinkActivity, noKey, connectedYandex);
  expect(text).toContain("referring.example");
  expect(text).not.toContain("DATAFORSEO_API_KEY");
});

it("returns to the badge with the reconnect reason when Yandex's grant is dead", () => {
  const text = renderWidget(DashboardBacklinks, noKey, deadGrantYandex);
  expect(text).toContain("DATAFORSEO_API_KEY");
  expect(text).toContain("Could not mint a Yandex Webmaster token");
});

it("shows the bare badge when neither source can provide links", () => {
  const text = renderWidget(DashboardLinkActivity, noKey, {
    ...deadGrantYandex,
    unavailableReason: null,
  });
  expect(text).toContain("DATAFORSEO_API_KEY");
  expect(text).not.toContain("referring.example");
});

it("keeps the DataForSEO table when the key is present", () => {
  const text = renderWidget(
    DashboardBacklinks,
    { dataforseo: true },
    connectedYandex,
  );
  // The degradation branch is not mounted at all, so neither the Yandex note
  // nor its rows are in it.
  expect(text).not.toContain("past 30 days");
  expect(text).not.toContain("referring.example");
});
