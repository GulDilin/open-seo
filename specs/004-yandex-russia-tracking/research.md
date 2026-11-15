# Research: Yandex Russia Provider

Facts verified October 2026 from Yandex Cloud docs and the migration
decisions document. Items marked "AT INTEGRATION" are pinned by a task
that records live values before code finalizes — they do not block
planning.

## R1: Official API over scrapers/aggregators

- **Decision**: Yandex Search API (searchapi.api.cloud.yandex.net family)
  for Yandex SERP; Wordstat methods of the same product for volumes.
- **Rationale**: only source of true Russian regional results (geo-
  dependent SERP) without captcha; ruble billing; 2025-launched
  synchronous Wordstat API.
- **Alternatives considered**: SerpApi/Bright Data for Yandex (rejected —
  no RU egress, irrelevant regional results); Мутаген (rejected —
  mandatory attribution + resale ban); Keys.so/Топвизор (overlay tools,
  not raw data); self-scraping Wordstat (captchas, brittle).

## R2: Two collection modes

- **Decision**: manual checks → synchronous endpoint; scheduled checks →
  deferred submit + poll. Deferred ≈ 16× cheaper (≈30.5 ₽ vs ≈488 ₽ per
  1000). Poll inside the scheduler tick; a result not ready at tick end
  stays pending and is collected next tick (bounded retry window).
- **Rationale**: mirrors the incumbent's task_post/task_get economics the
  scheduler already understands.
- **Alternatives considered**: sync everywhere (16× cost on the highest
  volume path); durable queue (rejected until tick window proves tight).

## R3: Auth and headers

- **Decision**: service-account API key + folder id headers on every call
  (names AT INTEGRATION per current docs; Yandex has used
  `Authorization: Api-Key …` + `x-folder-id`).
- **Rationale**: static key works in Workers without OAuth flows.
- **Alternatives considered**: IAM token exchange (rejected: token
  rotation machinery for no benefit with a static key).

## R4: Regions

- **Decision**: fetch region tree (free method) once → KV `yandex-regions`
  (30d TTL); searchable by name (ru/en); tracker stores the region id;
  checks pass it as the regional parameter. Trackers with a removed
  region keep working (warning logged).
- **Alternatives considered**: hardcoded region list (rejected: Yandex
  ids are theirs to renumber); per-request directory calls (rejected:
  cost/latency).

## R5: Wordstat volumes

- **Decision**: `KeywordDataProvider` from Wordstat top-queries data:
  national or regional volume per keyword; cpc/competition/difficulty =
  null; source "wordstat". Research for market 643: keyword list from
  provider-suggested related queries + Wordstat expansion; volume column
  filled; KD/intent columns render unavailable (existing googleAdsOnly
  pattern). `refresh-metrics` for 643 calls wordstat.
- **Rationale**: spec FR-004 (honest unavailability); Wordstat is the
  demand truth for Yandex-driven traffic.
- **Alternatives considered**: Google-Ads volumes for RU (do not exist —
  Ads suspended in RU); blended estimates (rejected: fabrication).

## R6: Quotas and pacing

- **Decision**: scheduler counts deferred yandex batches in the existing
  per-tick budget; RPS-shaped by batch size (observed AT INTEGRATION;
  initial conservative default 10 concurrent).
- **Rationale**: unknown-until-live quotas; conservative start, tune from
  provider error rates (429s) — same posture the repo took with the
  incumbent's 2000/min.
- **Alternatives considered**: config knobs per operator (deferred until
  someone needs them).
