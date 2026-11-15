# Data Model: Serper Google Provider

No schema changes. This feature instantiates the 001 contracts.

## Provider instance: serper

- `id: "serper"`, `engines: ["google"]`.
- `isConfigured()`: `SERPER_API_KEY` present (feature 001 rules).
- `checkRank(input: SerpRankCheck): Promise<SerpRankResult>`:
  - depth clamped to 100 (`input.depth` > 100 → 100; clamp surfaced via
    the estimate/notice path, not an error).
  - device maps 1:1.
  - region: NOT sent for Google in this phase (Serper `location` param is
    US-centric); city-level Google trackers stay on the incumbent path
    until a region parameter story exists (tracked as a limitation note).
- Snapshot export for research: organic + places arrays mapped to the
  existing internal snapshot item type.

## Derived data written

- Rank-check result row (existing shape): position or null, url, check
  metadata naming provider "serper" where the existing runner records
  task origin.
- R2 snapshot object (existing shape/version): items identical in
  meaning to the incumbent's organic/places items.

## Validation (adapter boundary)

- Response validated by Zod: `organic: array({position?, link, title})`,
  unknown keys passthrough; on schema failure → provider failure error
  (never a partial rank).
- `SerpRankCheck` inputs come from already-validated tracker config; the
  adapter still asserts engine === "google" (defense at boundary).
