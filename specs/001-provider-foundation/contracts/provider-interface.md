# Contract: SEO provider interfaces

TypeScript contracts defined in `src/server/lib/seo-providers/types.ts`.
These are internal module contracts (the seam Constitution IV protects);
external users never see them directly.

## SerpProvider

```ts
export interface SerpRankCheck {
  keyword: string;
  engine: SearchEngine;
  country: string;       // ISO 3166-1 alpha-2
  language: string;      // ISO 639-1
  region?: string;       // provider-scoped region id (Yandex lr, etc.)
  device: "desktop" | "mobile";
  targetDomain: string;
  depth: number;         // 10..100
}

export interface SerpRankResult {
  position: number | null;   // 1-based organic; null = not ranking
  url: string | null;
  topResults: Array<{
    position: number;
    domain: string;
    url: string;
    title: string;
  }>;
}

export interface SerpProvider {
  readonly id: ProviderId;
  readonly engines: readonly SearchEngine[];
  checkRank(input: SerpRankCheck): Promise<SerpRankResult>;
}
```

(Amended 2026-10-21 by feature 003: `isConfigured()` removed — provider
selection reads credential presence from providers.ts; async env access in
Workers cannot back a sync method, and the resolver already guarantees a
resolved adapter was configured.)

Rules:

- Implementations MUST NOT throw raw HTTP errors: failures surface as the
  app error type with `providerId` attached.
- `topResults` is capped at `depth` and contains ONLY organic items.
- Wire formats stay inside the implementing module (Constitution IV).

## KeywordDataProvider

```ts
export interface KeywordVolumeQuery {
  keyword: string;
  country: string;   // ISO alpha-2
  language: string;
  region?: string;
}

export interface KeywordVolumeRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;   // 0..1 normalized
  difficulty: number | null;
  source: "wordstat" | "dataforseo" | "ahrefs";
}

export interface KeywordDataProvider {
  readonly id: ProviderId;
  getVolumes(queries: KeywordVolumeQuery[]): Promise<KeywordVolumeRow[]>;
}
```

Rules:

- Missing data is `null`, never 0.
- Row order follows query order; rows never silently dropped (a keyword
  with no data returns volume `null`).
