# Quickstart: Yandex Russia Provider

## Prerequisites

Features 001–003 merged. Yandex Cloud service account with Search API
access; `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID` set. A .ru domain
with real Yandex presence (e.g. your own site).

## Scenario A — manual Yandex check (SC-001)

1. Create tracker: domain, market Russia, engine Yandex, region Moscow.
2. Add 10 keywords with known Yandex positions.
3. Run manual check.

**Expected**: positions recorded; spot-check 10 keywords against
yandex.ru in a Moscow-ge profile — ≥80% within ±1.

## Scenario B — regional vs national (FR-001)

1. Duplicate the tracker without a region (national).
2. Run both.

**Expected**: regional and national results differ for at least some
geo-dependent keywords (Moscow scope is genuinely applied).

## Scenario C — deferred equivalence (SC-003)

1. Schedule the Moscow tracker (or trigger the scheduler).
2. Wait for the deferred collection to land.

**Expected**: recorded positions match the manual run for ≥95% of
keyword-checks (same day).

## Scenario D — Wordstat research (SC-002)

1. In a Russia-market project, research seed "купить кроссовки".
2. Compare volumes for 20 keywords against public Wordstat.

**Expected**: volumes match 100% (national); difficulty/intent render
"unavailable"; saving keywords and refreshing metrics re-queries Wordstat
and updates volumes.

## Scenario E — region directory (US3)

1. Tracker region picker: search "Екатеринбург" and "Yekaterinburg".

**Expected**: both find the region; picker stays fast on repeat (cache
hit — verify single directory fetch in logs).

## Scenario F — missing credentials (FR-007)

1. Remove Yandex env; attempt a check.

**Expected**: failure names both credential variables; nothing recorded.
