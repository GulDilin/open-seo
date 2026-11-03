# Contract: Yandex adapter

Implements `SerpProvider` and `KeywordDataProvider` (001 contracts).

## SERP (engine "yandex")

| Internal | Yandex |
| --- | --- |
| keyword | query text |
| country "ru" | fixed RU scope |
| region (id) | regional parameter (AT INTEGRATION exact field name) |
| device desktop/mobile | device flag |
| depth | clamp to provider max page size; documented in clamp notice |
| targetDomain | client-side match (host equals / subdomain), organic only |

- Manual checks: synchronous call, one request per keyword.
- Scheduled checks: deferred submit (batch) → poll → collect; equivalence
  with sync is an acceptance criterion (SC-003).
- Organic extraction: urls/passes normalized to `{position, url, domain,
  title}`; ads and aggregate blocks excluded from matching.

## Wordstat

```ts
getVolumes([{keyword, country: "ru", language, region?}, ...])
  → KeywordVolumeRow[]   // volume from Wordstat; rest null; source "wordstat"
```

- Batch limits per provider docs (AT INTEGRATION; chunk + join preserving
  input order).
- Keyword with no Wordstat row → volume null (row kept).

## Region directory

```ts
listRegions(): Promise<RegionEntry[]>        // KV-cached, 30d
searchRegions(query: string): Promise<RegionEntry[]>
```

## Errors

Same table as Serper adapter (permanent 4xx except 429; one retry on
429/5xx/timeout); `providerId: "yandex"`; deferred terminal states map to
check failures with reason strings the tracker UI renders verbatim
("deferred result lost", etc.).

## Out of scope (hard boundaries)

- No volumes/cpc/difficulty invention for RU (all null except volume).
- No non-RU Yandex markets (Yandex serves other CIS markets; entry only
  when a market is added to availability with a tested need).
- No AI-visibility or backlink data for Yandex.
