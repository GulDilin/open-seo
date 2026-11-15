# Data Model: Incumbent Exit

No schema changes; nothing written or deleted.

## Routing changes

| Engine | Chain before | Chain after |
| --- | --- | --- |
| google | serper → dataforseo | serper |
| yandex | yandex | unchanged |
| baidu / bing | brightdata | unchanged |

Invariant: with no `SERPER_API_KEY`, a Google check now fails naming that
variable (no silent incumbent fallback) — this is intended and matches
SC-001's fleet-only premise; docs state the operator requirement.

## Credential presence model

Two independent capability statuses derived from env (single reader from
feature 001):

- `rankTrackingAvailable` = serper OR (yandex for yandex-engine trackers)
  OR (brightdata for baidu/bing) — practically: per-engine, surfaced as
  "engines ready: google, yandex…".
- `incumbentDataAvailable` = DATAFORSEO_API_KEY present.

## Dependency surfaces (read-path states)

Each surface: configured → works as today; absent → explanatory state
naming the incumbent and where to configure; previously cached/stored
data remains visible (FR-004) with refresh disabled.

 enumerated in contracts/incumbent-dependency-map.md.
