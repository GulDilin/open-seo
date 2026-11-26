import { env } from "cloudflare:workers";
import { z } from "zod";
import { getOptionalEnvValue } from "./runtime-env";

/**
 * Ahrefs publishes a free Domain Rating lookup that still requires an APIv3
 * key (free to generate, no units consumed — keyless requests get a 403).
 * Shared by the Backlinks table's on-demand column and the domain rating's
 * fallback — no billing, no stored data. Every result (a DR, including a
 * legitimate 0 for a domain with no backlink profile yet) is cached in KV
 * for a day so repeat lookups are free.
 */
const AHREFS_DR_ENDPOINT =
  "https://api.ahrefs.com/v3/public/domain-rating-free";
const CACHE_PREFIX = "ahrefs-dr:";
const CACHE_TTL_SECONDS = 86_400; // 24 hours
const FETCH_TIMEOUT_MS = 5_000;

const ahrefsResponseSchema = z.object({
  domain_rating: z.object({
    domain_rating: z.number().min(0).max(100),
  }),
});

/** Cache-first DR lookup for a single normalized domain. Throws on failure. */
export async function getAhrefsDomainRating(domain: string): Promise<number> {
  const cacheKey = `${CACHE_PREFIX}${domain}`;
  const cached = await env.KV.get(cacheKey);
  if (cached !== null) return parseCachedRating(cached);

  const dr = await fetchDomainRating(domain);
  await env.KV.put(cacheKey, JSON.stringify(dr), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
  return dr;
}

async function fetchDomainRating(domain: string): Promise<number> {
  const apiKey = await getOptionalEnvValue("AHREFS_API_KEY");
  if (!apiKey) {
    // Named, not a bare 403: this error becomes the rating's visible reason.
    throw new Error("Ahrefs API key is not configured (AHREFS_API_KEY)");
  }
  const response = await fetch(
    `${AHREFS_DR_ENDPOINT}?target=${encodeURIComponent(domain)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`Ahrefs DR lookup failed with status ${response.status}`);
  }

  const parsed = ahrefsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Ahrefs DR lookup returned an unexpected response");
  }

  // DR 0 is a real rating — a domain with no backlink profile in Ahrefs' index
  // — and the UI displays it as 0, not as an absent rating.
  return parsed.data.domain_rating.domain_rating;
}

function parseCachedRating(raw: string): number {
  try {
    const value: unknown = JSON.parse(raw);
    // Legacy entries stored DR 0 as JSON "null" (the old "no rating" mapping);
    // under the current semantics 0 is a real rating, so translate them.
    if (value === null) return 0;
    return typeof value === "number" ? value : 0;
  } catch {
    return 0;
  }
}
