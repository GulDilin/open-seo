# Quickstart: Multi-Engine Domain Model

## Prerequisites

Features 001 merged. Local dev with SQLite; optional PG via
`LOCAL_POSTGRES.md` to exercise both dialects.

## Scenario A — zero-action upgrade (SC-001)

1. Run pg + sqlite migrations on a copy of a populated dev DB.
2. Start the app; open an existing project's trackers.

**Expected**: every pre-existing tracker shows engine "Google"; schedules,
history, and next-run times unchanged; no operator action performed.

## Scenario B — engine picker per market (SC-002)

1. Create tracker → market US → engine options: Google only.
2. Market Norway → Google, Bing.
3. Market Russia → Yandex, Google.
4. Market China → Baidu only.
5. Submit Russia + Yandex + domain `example.ru`.

**Expected**: tracker created with engine Yandex; shows in list with an
engine badge.

## Scenario C — uniqueness per engine (FR-002)

1. Existing tracker: example.ru / Russia / Yandex.
2. Attempt duplicate Russia/Yandex → rejected with validation error.
3. Create Russia/Google for same domain → succeeds; both listed.

**Expected**: DB-level rejection on same-engine duplicate (verify by
attempting direct service call bypassing UI validation — the insert fails).

## Scenario D — MCP parity (FR-007)

1. `create_rank_tracker` without `searchEngine` → google tracker.
2. With `searchEngine: "baidu"`, market Norway → tool error listing
   supported engines.
3. `get_rank_tracker` on a yandex tracker → `searchEngine: "yandex"`.

## Scenario E — first check of an engine without a provider (edge case)

1. Run a manual check on the Yandex tracker (no Yandex credentials).

**Expected**: check result = failed, reason names engine and missing
credential variables; no position recorded; UI shows actionable state.
