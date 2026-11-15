# Contract: Ahrefs volume provider

Implements `KeywordDataProvider` (001 contract). Volume-only; optional.

## Activation

Configured only when its credential env is present. When absent it never
appears in resolution results; markets degrade per the routing table in
`data-model.md`.

## Request mapping

| Internal | Ahrefs |
| --- | --- |
| keyword list | keywords endpoint batch parameter |
| country (ISO alpha-2) | country parameter |
| volume/cpc/difficulty | response fields per their public API spec |

## Response rules

- Row per input keyword, input order preserved; missing → volume null.
- `source: "ahrefs"` on every row.
- Difficulty normalized to the internal scale used by
  `keyword-metrics.ts` (same treatment as incumbent rows).

## Error contract

Same table as other adapters (4xx permanent except 429; one retry on
429/5xx/timeout); `providerId: "ahrefs"`; batch-internal failures do not
abort sibling keywords.
