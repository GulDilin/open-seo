# Data Model: Bright Data Provider

No schema changes.

## Provider instance: brightdata

- `id: "brightdata"`, `engines: ["baidu", "bing"]`, configured =
  `BRIGHTDATA_API_TOKEN` present.
- `checkRank(input)`: engine must be baidu|bing (asserted pre-network);
  country/language geo params per engine; depth clamped to provider
  per-request organic max (recorded at integration; default 50 for Baidu,
  100 for Bing — clamps surfaced like feature 003).
- Output: standard `SerpRankResult`; same host-match rule.

## Derived data written

Rank-check result rows via the existing provider-neutral storage; check
metadata provider "brightdata", engine from tracker.

## Validation

- Response Zod schema: organic array with link/title/(position?);
  unknown keys passthrough. Chinese-language keywords passed through
  as-is (no transliteration — spec edge case).
- Failures: same error table as feature 003 with `providerId:
  "brightdata"`; per-check isolation (batch continues).
