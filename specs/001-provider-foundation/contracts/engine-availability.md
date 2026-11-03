# Contract: Engine availability table

Defined in `src/shared/search-engines.ts`. Consumed by: client engine
pickers (feature 002), server-side tracker validation (feature 002), MCP
tool validation (feature 002), provider resolver.

```ts
export const SERP_PROVIDER_CHAIN: Record<SearchEngine, ProviderId[]> = {
  google:  ["serper", "dataforseo"],
  yandex:  ["yandex"],
  baidu:   ["brightdata"],
  bing:    ["brightdata"],
};

// market numeric code → engines offered; unlisted markets default to ["google"]
export const ENGINE_AVAILABILITY: Record<number, readonly SearchEngine[]>;

export function enginesForCountry(code: number): readonly SearchEngine[];
export function isEngineAvailableForCountry(code: number, e: SearchEngine): boolean;

export const searchEngineSchema = z.enum(["google", "yandex", "baidu", "bing"]);
export const searchEngineField = searchEngineSchema.default("google");
```

Invariants (unit-tested):

1. Every chain engine has ≥1 provider id; every provider id is a known id.
2. Chain entries and `engines` arrays on provider descriptors agree.
3. Availability values are non-empty subsets of the engine union.
4. Default for unknown market codes is `["google"]` (preserves today's
   behavior for every existing market until feature 002 extends entries).
