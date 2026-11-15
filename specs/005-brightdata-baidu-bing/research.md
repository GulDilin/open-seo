# Research: Bright Data Baidu/Bing

Verified October 2026. No open clarifications.

## R1: Provider choice for Baidu/Bing

- **Decision**: Bright Data SERP API.
- **Rationale**: only fleet-viable provider covering both Baidu and Bing
  (7 engines, 195 countries); PAYG $1–1.5/1k; 5k free requests/month.
- **Alternatives considered**: SerpApi (covers both, 4–20× price);
  SearchApi/HasData (narrower or pricier); Chinese platforms 5118/Chinaz
  for Baidu (no Baidu-SERP-positions API with the needed shape + yuan
  billing; declared out of scope in decisions §6).

## R2: Bing context

- **Decision**: Bing via Bright Data everywhere Bing is declared.
- **Rationale**: official Bing Search API retired by Microsoft (Aug 2025);
  scraper APIs are the only Bing source left.
- **Alternatives considered**: none viable.

## R3: Request/response shape

- **Decision**: engine parameter (`baidu`/`bing`), country/language geo
  params; response validated to organic list then mapped exactly like the
  Serper adapter (host-based domain match, organic-only). Exact parameter
  names AT INTEGRATION from provider docs (task pins them via a recorded
  fixture before code review).
- **Alternatives considered**: per-engine adapters (rejected — same API,
  one mapping).

## R4: Availability-first validation

- **Decision**: engine/market validation happens at input (feature 002
  schemas); the adapter additionally asserts the engine is one of its own
  before any network call — impossible pairs never cost money.
- **Rationale**: spec SC-003 (100% validation before provider spend).

## R5: Jurisdiction note

- **Decision**: document (self-hosting docs) that the Bright Data account
  is operator-procured; no code-level gating.
- **Rationale**: provider onboarding/KYC is between operator and vendor;
  the product treats absence of a token uniformly across providers.
