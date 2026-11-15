# Research: Multi-Engine Domain Model

Pre-decided in `docs/maintainers/provider-migration/` (decisions §3.5, §4,
tasks T1.1–T1.3). Restated in plan format; no open clarifications.

## R1: Engine as a column vs. separate tracker type rows

- **Decision**: `search_engine text not null default 'google'` on
  `rank_tracking_configs`.
- **Rationale**: a tracker is defined for exactly one engine; engines never
  mix within a tracker. A column keeps every existing query, list, and
  schedule read unchanged.
- **Alternatives considered**: engine on the keyword row (rejected: the
  same keyword list checked in two engines is two trackers' concern, not
  per-keyword state); separate `tracker_engines` table (rejected: 1:1
  mandatory relation, no benefit).

## R2: Uniqueness semantics

- **Decision**: rebuild the two partial unique indexes from migration
  `0006_location_name.sql` to include `search_engine`: national tracker
  unique per (project, domain, location_code, search_engine); local
  (city) tracker unique per (project, domain, location_code,
  search_engine, location_name).
- **Rationale**: spec FR-002 — same domain/market on Google and Yandex
  must coexist; same-engine duplicates stay rejected at the DB level, not
  only in service code.
- **Alternatives considered**: service-level check only (rejected: races
  and drift; the repo pattern keeps hard invariants in indexes).

## R3: Market codes for Russia and China

- **Decision**: Russia 643, China 156 (ISO 3166-1 numeric) — deliberately
  NOT DataForSeo codes, which do not exist for these countries. The
  internal numeric key stays the market identifier; ISO alpha-2 for
  provider calls derives via `getIsoCountryCode()` (RU/ZH shortLabel).
- **Rationale**: decisions §2.4 — avoids a repo-wide migration to ISO
  keys while keeping the namespace collision-free (no existing 643/156
  entries).
- **Alternatives considered**: migrating all location codes to ISO
  (rejected: touches 5 tables and every picker for zero user value now);
  provider-specific market tables (rejected: duplicate sources of truth).

## R4: Language defaults for the new markets

- **Decision**: Russia → `ru`; China → `zh-CN` (SERP language list
  format; note the spec-0004 zh_CN vs zh-CN conflict applies to Ads-only
  routing, not to engine availability — China is engine-restricted to
  Baidu and never routes to keyword-data endpoints).
- **Rationale**: matches how `MULTI_LANGUAGE_LOCATIONS` and
  `SERP_LANGUAGE_OPTIONS` already behave.
- **Alternatives considered**: en default (rejected: wrong primary search
  market for both).

## R5: Volume availability reporting for new markets

- **Decision**: `getKeywordDataProvider(643) → "wordstat"` (feature 004
  wires the actual provider; until then research for Russia reports
  volumes unavailable), `(156) → "none"` (honest unavailable).
- **Rationale**: spec FR-006 forbids substitution; the union type already
  has the `googleAdsOnly` precedent for capability gaps.
- **Alternatives considered**: hiding Russia/China from research entirely
  until providers land (rejected: trackers are the P1 value; research can
  ship position/SERP data meanwhile).

## R6: MCP surface changes

- **Decision**: optional `searchEngine` (default google) on
  create-tracker input; engine echoed in tracker-reading outputs;
  validation error lists supported engines for the market.
- **Rationale**: UI/MCP parity is an existing product pattern; per
  AGENTS.md plugin rules, schema/description changes to existing tools
  need no plugin version bump; `pnpm sync-plugin-skills` still runs if any
  shipped skill mentions tracker creation.
- **Alternatives considered**: a separate create-yandex-tracker tool
  (rejected: N tools per engine is the drift the shared table prevents).
