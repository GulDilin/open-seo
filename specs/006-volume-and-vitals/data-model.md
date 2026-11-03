# Data Model: Vitals + Volumes

No schema changes.

## Vitals (source swap)

- Input: audited page URL (+ device strategy desktop/mobile as today).
- Output: existing `StoredLighthousePayload` — scores (performance,
  accessibility, best-practices, seo) + metrics (LCP, CLS, INP, TTFB).
  Shape unchanged; only the producing client changes.
- Failure: per-page error in the audit's existing issue/step recording;
  audit continues (FR-003).

## Volume provider: ahrefs (optional)

- `id: "ahrefs"`; `getVolumes(queries)` → `KeywordVolumeRow[]` with
  `source: "ahrefs"`; volume + cpc from provider; difficulty as returned
  (normalized 0–100 → internal 0–100 scale as today's keyword-metrics
  path does); competition null unless provider supplies a 0..1-able
  value.
- Configured = credential present; not in any SERP chain (volume-only
  provider — `engines: []`).

## Volume routing table (extension of 001's keyword chain)

| Market | Source (priority) |
| --- | --- |
| Russia (643) | wordstat |
| China (156) | none |
| Labs-served markets | incumbent → (if absent) ahrefs → unavailable |
| Ads-only markets | incumbent google_ads → (if absent) ahrefs → unavailable |

Row semantics: first CONFIGURED source in the column wins; result rows
carry `source` so UI can attribute.

## Validation

- PSI response: `lighthouseResult` Zod schema; missing pages → per-page
  failure.
- Ahrefs response: validated subset; unknown keys passthrough; missing
  keyword → null-volume row (never dropped).
