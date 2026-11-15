# Quickstart: Bright Data Baidu/Bing

## Prerequisites

Features 001–004 merged. `BRIGHTDATA_API_TOKEN` set. A domain with Baidu
presence (Chinese content) and any domain with Bing rankings.

## Scenario A — Baidu checks (SC-001)

1. Tracker: domain, market China, engine Baidu, 10 keywords.
2. Manual check; verify 10 keywords manually on baidu.com.

**Expected**: ≥80% within ±1 position; results recorded with urls.

## Scenario B — Bing checks (SC-002)

1. Tracker: same domain, market Norway, engine Bing.
2. Manual check.

**Expected**: positions recorded; spot-check vs bing.com in the market.

## Scenario C — engine/market separation (US2 acceptance 2)

1. Project with Google (Serper) + Bing trackers on one domain, one market.

**Expected**: both trackers collect independently; results never mix
(different engines visible per tracker).

## Scenario D — no paid calls for impossible pairs (SC-003)

1. Attempt direct service call creating a Baidu tracker for Norway.

**Expected**: validation error listing supported engines; provider request
count unchanged (logs).

## Scenario E — token absent (FR-004)

1. Remove token; attempt Baidu check.

**Expected**: failure names `BRIGHTDATA_API_TOKEN`; nothing recorded.
