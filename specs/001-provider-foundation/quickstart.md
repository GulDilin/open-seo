# Quickstart: Provider Foundation

Validation guide — proves the feature end-to-end without any feature code
using it yet.

## Prerequisites

- Repo dev environment running (see `docs/LOCAL_DEVELOPMENT.md`).
- No new env vars set (baseline case).

## Scenario A — zero behavior change (SC-001)

1. `pnpm test` (full suite) — green.
2. Open the app, create a project/tracker as usual — everything identical.
3. Preflight/self-host status: DataForSeo row behaves as before; three new
   provider rows show "not configured", non-blocking.

**Expected**: no new errors, no visible differences beyond the new status
rows.

## Scenario B — credential presence (SC-002)

1. Set `SERPER_API_KEY=test-key` in `.env.local`; restart dev server.
2. Open preflight → Serper shows "configured".
3. Unset it, set empty string → "not configured".
4. Repeat for `YANDEX_SEARCH_API_KEY` alone (expect "not configured" —
   requires folder id too), then add `YANDEX_FOLDER_ID` → "configured".
5. `BRIGHTDATA_API_TOKEN=token` → "configured".

**Expected**: status flips correctly in all 8 combinations spot-checked;
no secret value ever appears in the UI (inspect the rendered page source).

## Scenario C — resolver semantics (SC-004, FR-004/005)

Via unit tests (`routing.test.ts`) and one manual node REPL check:

1. `resolveSerpProvider("google")` with Serper set → serper id.
2. Same without any new env → dataforseo id (incumbent fallback intact).
3. `resolveSerpProvider("yandex")` without Yandex creds → error listing
   `YANDEX_SEARCH_API_KEY`, `YANDEX_FOLDER_ID`.
4. Availability: `isEngineAvailableForCountry(2840, "google")` → true;
   `isEngineAvailableForCountry(2840, "baidu")` → false.

**Expected**: errors name variables; no engine substitution ever occurs.
