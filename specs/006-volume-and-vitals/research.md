# Research: Free Vitals + Ahrefs Volumes

Verified October 2026. No open clarifications.

## R1: Vitals source

- **Decision**: Google PageSpeed Insights API (`lighthouseResult` payload)
  replacing the incumbent on-page Lighthouse endpoint.
- **Rationale**: same Lighthouse computation under the hood, free, no
  provider account; field metrics + four scores map 1:1 to the existing
  stored payload.
- **Alternatives considered**: running Lighthouse in the existing audit
  crawler (rejected: renderer cost and maintenance for equal data);
  keeping the incumbent (rejected: keeps a paid dependency the exit
  phase must remove anyway).

## R2: PSI quota handling

- **Decision**: pace vitals calls (small concurrency, e.g. 2–4) within the
  audit's existing page loop; per-page failure isolation (spec FR-003).
- **Rationale**: PSI free tier is generous per-key and keyless; pacing
  covers bursts on large audits without a queue system.
- **Alternatives considered**: API key plumbing for higher quotas
  (deferred: optional env note only if a real audit hits the ceiling —
  `ponytail:` note in code).

## R3: Volume provider for incumbent-served markets

- **Decision**: Ahrefs API v3 behind the 001 contract; active only when
  `AHREFS_API_KEY`-style credential present; market routing extended:
  labs-markets → incumbent while it exists, then ahrefs; ru → wordstat
  (feature 004); cn → none.
- **Rationale**: Ahrefs country coverage (`no`, `cn`, `ru`, 210 codes)
  verified against their public API spec; volume+cpc+difficulty from one
  source keeps rows internally consistent.
- **Alternatives considered**: Semrush API (similar coverage, heavier
  commercial add-on); leaving volumes incumbent-only (rejected: exit
  phase 007 would strand volumes).

## R4: Honest degradation

- **Decision**: no volume provider configured for a market → explicit
  unavailable states in research/refresh (feature 002 pattern); provider
  returns no row → that keyword's volume null.
- **Rationale**: spec FR-005; consistency with the googleAdsOnly and
  wordstat precedents.

## R5: Score variance acceptance

- **Decision**: acceptance compares PSI vs incumbent on a 10-page sample;
  variance documented at acceptance rather than hard-coded tolerance (run
  environment affects Lighthouse scores naturally).
- **Rationale**: SC-002 wording; Lighthouse run-to-run variance is a known
  property — a fixed numeric gate would flake.
