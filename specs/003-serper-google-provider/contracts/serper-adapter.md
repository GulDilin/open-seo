# Contract: Serper adapter

Implements `SerpProvider` (see
`specs/001-provider-foundation/contracts/provider-interface.md`).

## Request mapping

| Internal | Serper |
| --- | --- |
| keyword | `q` |
| country (ISO alpha-2) | `gl` |
| language | `hl` |
| depth (clamped 100) | `num` |
| device desktop/mobile | `device` desktop/mobile |

## Response contract (validated subset)

```jsonc
{
  "organic": [
    { "position": 1, "link": "https://...", "title": "..." }
  ],
  "places": [ /* optional; snapshots only */ ]
}
```

- `position` optional: fallback = array index + 1.
- Any shape deviation → `SerpProviderError` (provider failure), no partial
  results.

## Rank matching rule

Given `targetDomain = "example.com"` and result host `h`:
match iff `h === targetDomain` or `h.endsWith("." + targetDomain)`.
First matching organic item wins; its `position` is recorded; `url` is its
`link`. No match → `position: null, url: null`.

## Error contract

| Condition | Behavior |
| --- | --- |
| 400/401/403 | permanent failure, no retry, `providerId: "serper"` |
| 429, 5xx, timeout | 1 retry, then failure |
| schema mismatch | failure (treated like 5xx for retry purposes: 1 retry) |

Failures never fabricate positions and never abort sibling checks
(consumed by the workflow's per-check error handling).
