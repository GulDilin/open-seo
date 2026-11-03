# Data Model: Yandex Russia Provider

No relational schema changes. New derived/cached entities:

## Provider instance: yandex (serp)

- `id: "yandex"`, `engines: ["yandex"]`, configured = key AND folder id.
- `checkRank` input: country always "ru"; `region` = Yandex region id
  (optional; absent = national).
- Output: standard `SerpRankResult`; matching rule identical to Serper
  (host equals or subdomain-of target).

## Collection state (deferred mode, in scheduler run state)

| State | Meaning | Transition |
| --- | --- | --- |
| submitted | batch accepted, id held | → pending on ack |
| pending | result not ready | → collected (poll ok) / failed (terminal error) / pending (next tick, until window closes) |
| collected | results normalized and written | terminal |
| failed | provider error named | terminal; keywords re-checkable next run |

Window: pending batches older than N ticks (default 4) → failed with
"deferred result lost" reason (spec edge case).

## Region directory (KV: yandex-regions)

- Entries: `{ id: number, name: string, nameEn?: string, type:
  "country"|"region"|"city", parentId?: number }`.
- Search: case-insensitive substring on name/nameEn; returns id + label.
- Tracker stores region id at create; label resolved for display from
  cache (fallback: stored label snapshot on the tracker row if provided).

## Wordstat volume rows

- `KeywordVolumeRow { volume, cpc: null, competition: null, difficulty:
  null, source: "wordstat" }`.
- Regional runs: volume reflects the region id passed (spec FR-004).
- Stored via existing keyword-metrics path keyed by market 643; KD/intent
  columns absent → UI unavailable state (feature 002 pattern).

## Research list for market 643

- Source: provider suggested queries + Wordstat expansion of the seed.
- No Labs/google-ads endpoints called for 643 (they cannot serve it).
