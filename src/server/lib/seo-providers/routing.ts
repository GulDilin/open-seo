import { AppError } from "@/server/lib/errors";
import {
  SEO_PROVIDER_CREDENTIALS,
  SERP_PROVIDER_CHAIN,
  type ProviderId,
  type SearchEngine,
} from "@/shared/search-engines";
import { getSeoProviderStatuses } from "./providers";
import type { SerpProvider } from "./types";
import { serperProvider } from "./serper/adapter";
import { yandexProvider } from "./yandex/adapter";
import { brightDataProvider } from "./brightdata/adapter";

/** City-level google needs sub-country geo only the incumbent serves
 *  (decisions §5): serper is never consulted, even when configured. */
const CITY_GOOGLE_CHAIN: readonly ProviderId[] = ["dataforseo"];

/**
 * Walk the engine's provider chain and return the first configured provider.
 * Never substitutes engines: a request for an engine with no configured
 * provider fails, naming exactly which credentials are missing.
 */
export async function resolveSerpProvider(
  engine: SearchEngine,
  options?: { cityLevel?: boolean },
): Promise<ProviderId> {
  const chain =
    options?.cityLevel && engine === "google"
      ? CITY_GOOGLE_CHAIN
      : SERP_PROVIDER_CHAIN[engine];
  const statuses = await getSeoProviderStatuses();
  for (const id of chain) {
    if (statuses[id]) {
      return id;
    }
  }
  const missing = [
    ...new Set(chain.flatMap((id) => SEO_PROVIDER_CREDENTIALS[id])),
  ].join(", ");
  throw new AppError(
    "UPSTREAM_UNAVAILABLE",
    `No SERP provider configured for engine "${engine}"${options?.cityLevel ? " with city-level targeting" : ""}. Set one of: ${missing}.`,
  );
}

/**
 * Adapter instance for a resolved provider id. The incumbent (dataforseo)
 * returns null — its checks run on the metered client path in the workflow,
 * not through this interface.
 */
export function serpProviderById(id: ProviderId): SerpProvider | null {
  switch (id) {
    case "serper":
      return serperProvider;
    case "yandex":
      return yandexProvider;
    case "brightdata":
      return brightDataProvider;
    case "googleads":
    case "dataforseo":
      return null;
  }
}
