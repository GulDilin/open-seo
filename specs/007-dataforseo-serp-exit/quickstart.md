# Quickstart: Incumbent Exit

## Prerequisites

Features 001–005 accepted; 2-week parallel-run dataset meeting SC-002
(±1 ≥90%) archived; fleet credentials (serper, yandex, brightdata) set.

## Scenario A — fleet-only rank tracking (SC-001)

1. Remove `DATAFORSEO_API_KEY`.
2. For each engine — google, yandex, baidu, bing — create a tracker and
   run a manual check; let one scheduler tick fire for each.

**Expected**: create/schedule/run/history all work; nothing in the
tracking surface mentions a missing provider.

## Scenario B — preflight honesty (US1 acceptance 2)

1. Same credential-less state; open preflight.

**Expected**: "rank tracking: ready (google, yandex, baidu, bing)";
incumbent row shows not-configured WITHOUT implying breakage; a separate
"backlinks & AI data: needs DataForSeo" line states the real dependency.

## Scenario C — dependency states (SC-003)

1. Walk every surface in contracts/incumbent-dependency-map.md with the
   credential absent.

**Expected**: each "requires" surface shows the dependency state; each
"must NOT reference" surface shows nothing about the incumbent; audit
sheet checked row by row.

## Scenario D — rollback (SC-004 / FR-005)

1. Re-add `DATAFORSEO_API_KEY`; reload backlinks overview.

**Expected**: works immediately; histories intact (compare a count before
removal); no repair steps.

## Scenario E — no incumbent routing even when present (FR-002)

1. Keep fleet keys AND incumbent key set; run a Google check.

**Expected**: served by serper (check metadata); incumbent request
counter in logs unchanged for that check.
