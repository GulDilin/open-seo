# Research: Serper Google Provider

Provider facts verified October 2026 (serper.dev; pricing via search
confirmation). No open clarifications.

## R1: Request shape

- **Decision**: POST `https://google.serper.dev/search`, header
  `X-API-KEY`, JSON body `{ q, gl, hl, num: 100, device }`. `gl` = ISO
  alpha-2 via `getIsoCountryCode(locationCode)`; `hl` = tracker language.
- **Rationale**: single request returns up to 100 organic results —
  matches the product's max depth, removes the incumbent's sequential
  page-crawl cost/latency entirely.
- **Alternatives considered**: num=10 + paging (rejected: 10× the requests
  for the same answer); scraping Google directly (rejected: ToS, proxies).

## R2: Response mapping

- **Decision**: validate then map `organic[]` (fields `position`, `link`,
  `title`, `displayLink`-equivalent domain from URL host) to
  `SerpRankResult`. `position` from Serper is trusted when present;
  otherwise array index +1. Domain match: target domain equals host or
  host ends with `.`+target (subdomains count — spec FR-002). Local pack
  (`places[]`) maps into snapshots only, never into rank matching.
- **Rationale**: mirrors `buildRankCheckResult` semantics (organic-only
  matching) so cross-provider history stays comparable.
- **Alternatives considered**: matching on `displayLink` string (rejected:
  provider-normalization variance; URL host is unambiguous).

## R3: Integration point in the workflow

- **Decision**: at the tracker-check entry where live-vs-queue is chosen
  today (`RankCheckWorkflow.ts`), resolve the provider via feature 001's
  chain first: google + serper configured → Serper live path; google +
  incumbent only → existing path unchanged; other engines → features
  004/005.
- **Rationale**: single selection point prevents mixed-path drift; the
  incumbent queue path remains untouched for incumbent deployments.
- **Alternatives considered**: a provider-agnostic queue abstraction
  (rejected: premature — one provider has no queue semantics).

## R4: Budget accounting

- **Decision**: scheduled runs count 1 unit per keyword check on the
  Serper path (existing budget: 1000 units/tick against the incumbent's
  2000 req/min — the unit is our own throttle, provider-independent).
- **Rationale**: keeps the existing scheduler shaping without modeling
  provider-specific rate limits prematurely.
- **Alternatives considered**: mapping Serper credits to units 1:1 with
  num=100 counting 2 (deferred: only matters if Serper quota errors appear
  in practice).

## R5: Error semantics

- **Decision**: HTTP 4xx (except 429) → permanent check failure, no retry;
  429/5xx/timeout → 1 retry, then failure. All failures carry
  `providerId: "serper"` and mark only their keyword's check failed.
- **Rationale**: paid non-idempotent-style calls shouldn't retry
  aggressively (matches incumbent retry policy in `core.ts`); per-check
  failure isolation is spec FR-004.
- **Alternatives considered**: exponential backoff inside the check
  (rejected: the scheduler's next pass is the retry).

## R6: Cost facts (for estimate tooling)

- **Decision**: treat cost as $1.0 per 1000 checks (50k credits @ $50
  tier) for estimates; note "cheaper at volume" in UI copy.
- **Rationale**: conservative default tier; actual billing is
  credit-based on the operator's account.
- **Alternatives considered**: reading account tier via API (no such
  endpoint documented; rejected).
