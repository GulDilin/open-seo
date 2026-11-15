# Quickstart: Serper Google Provider

## Prerequisites

Features 001–002 merged. `SERPER_API_KEY` set (serper.dev, 2500 free
queries). A tracker on a domain you control, market US or Norway.

## Scenario A — Serper-only deployment (SC-001)

1. Unset `DATAFORSEO_API_KEY`; keep `SERPER_API_KEY`.
2. Run a manual check on a Google tracker (10 keywords, US).

**Expected**: all 10 keywords get positions or "not ranking"; top-results
visible; results tagged serper in check metadata.

## Scenario B — position parity (SC-002)

1. Pick 20 keywords; run the tracker.
2. Manually verify a sample of 10 against google.com in the same market
   (incognito, same language).

**Expected**: ≥90% within ±1 position. Record variance notes for any
misses (geo personalization is the usual cause).

## Scenario C — incumbent-only unchanged (SC-003)

1. Unset `SERPER_API_KEY`; set `DATAFORSEO_API_KEY`.
2. Full `pnpm test`; manual check on the same tracker.

**Expected**: suite green; behavior identical to pre-feature (queue/live
paths as before).

## Scenario D — provider failure isolation (SC-004)

1. Set `SERPER_API_KEY=invalid-key`; run a check.

**Expected**: every keyword's check fails with provider "serper" named;
no positions recorded; tracker shows actionable failure; a sibling
tracker on the incumbent path in the same scheduled run still completes
(simulate by running the scheduler tick once).

## Scenario E — SERP snapshot (FR-006)

1. With Serper active, open the SERP panel for a Norwegian keyword.
2. Reload within the cache window.

**Expected**: organic results render; second load served from cache (no
new provider request in logs).
