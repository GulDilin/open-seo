# Contract: PSI vitals source

Replaces the incumbent Lighthouse call inside
`src/server/lib/audit/lighthouse.ts`. Consumers see no contract change:
same input (URL, strategy) → same `StoredLighthousePayload`.

## Request

GET PageSpeed Insights, query params: url, strategy (desktop|mobile),
category set matching the four scores stored today.

## Response mapping

`lighthouseResult.categories.*.score` → four 0..1 scores;
`lighthouseResult.audits.{largest-contentful-paint, cumulative-layout-
shift, interaction-to-next-paint, server-response-time}.numericValue` →
metrics fields. Field names pinned by a recorded fixture test.

## Pacing & failure

- Concurrency-limited (default 3) within the audit page loop.
- Per-page failure → recorded against that page; audit proceeds.
- No retries beyond one on timeout (free source; next audit re-measures).
