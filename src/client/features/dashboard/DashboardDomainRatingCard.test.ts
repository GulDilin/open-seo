import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

// Only the server functions are stubbed; the card and its badge run for real
// against query data seeded into the cache.
vi.mock("@/serverFunctions/domain", () => ({
  getProjectDomainRating: vi.fn(),
  getProjectSqi: vi.fn(),
}));
vi.mock("@/serverFunctions/seo-providers", () => ({
  getSeoProviderSetup: vi.fn(),
}));
// The card links out of itself; static rendering has no router context.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: (props: { children?: React.ReactNode }) =>
    createElement("a", null, props.children),
}));

import { DashboardDomainRatingCard } from "./DashboardDomainRatingCard";

const ahrefsRating = {
  domain: "site.example",
  rank: 42,
  source: "ahrefs",
  reason: null,
};

function renderCard(rating: unknown) {
  const client = new QueryClient();
  client.setQueryData(["seo-provider-setup"], { dataforseo: false });
  client.setQueryData(["project-sqi", "p1"], {
    connected: false,
    sqi: null,
    hostUrl: null,
    unavailableReason: null,
  });
  client.setQueryData(["project-domain-rating", "p1"], rating);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(DashboardDomainRatingCard, { projectId: "p1" }),
    ),
  );
  client.clear();
  return load(html).text();
}

it("hides the DataForSEO badge when the rating came from the Ahrefs fallback", () => {
  const text = renderCard(ahrefsRating);
  expect(text).toContain("Ahrefs");
  expect(text).not.toContain("DATAFORSEO_API_KEY");
});

it("keeps the DataForSEO badge while no source produced a rank", () => {
  const text = renderCard({
    domain: "site.example",
    rank: null,
    source: null,
    reason: "Both providers failed",
  });
  expect(text).toContain("DATAFORSEO_API_KEY");
});
