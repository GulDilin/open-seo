# Quickstart: Vitals + Volumes

## Scenario A — vitals without incumbent credential (SC-001)

1. Unset `DATAFORSEO_API_KEY` (providers 003–005 keys may also be unset).
2. Run an audit on a 20–50 page site.

**Expected**: all pages get vitals scores + metrics; audit completes in
its normal duration budget; per-page failures (if any network hiccups)
don't abort the audit.

## Scenario B — vitals variance (SC-002)

1. Re-run the audit on a 10-page sample with the incumbent credential
   temporarily restored (old path) — or compare against last pre-change
   audit.

**Expected**: scores within normal Lighthouse run variance; document the
observed deltas at acceptance.

## Scenario C — volumes with ahrefs configured (SC-003)

1. Configure the ahrefs credential; research a Norwegian keyword set.

**Expected**: volumes (+cpc/difficulty where provided) appear with source
ahrefs; ≥95% of keywords show a volume or explicit unavailable — never
a fabricated number.

## Scenario D — volumes without any volume source (FR-005)

1. Unset ahrefs (and incumbent if in exit trials); research Norway.

**Expected**: volumes show unavailable; positions/SERP panels unaffected.

## Scenario E — mixed markets

1. One project, markets Russia + Norway; research both.

**Expected**: Russia → wordstat volumes; Norway → ahrefs/incumbent per
routing; no cross-market substitution anywhere.
