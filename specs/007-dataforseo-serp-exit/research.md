# Research: Incumbent Exit

Pre-decided in the migration decisions (§9). No open clarifications.

## R1: Exit = routing + honesty, not deletion

- **Decision**: remove the incumbent from fleet-covered chains; keep its
  client code for the roles still using it (backlinks, AI visibility,
  local, domain overview); dependency surfaces state their need.
- **Rationale**: FR-005 rollback (re-add credential → features return)
  is trivially true when nothing is deleted; deleting the client would
  force a rewrite of four unrelated features with no user value yet.
- **Alternatives considered**: full incumbent removal now (rejected —
  keep/replace decisions per role are explicitly out of scope, per
  decisions §9); config flag to keep incumbent in the google chain
  (rejected — one more mode to test, zero users).

## R2: Parallel-run evidence gate

- **Decision**: cutover requires the 2-week dataset meeting SC-002
  (±1 position ≥90%) recorded from feature 003's deployment.
- **Rationale**: spec's own gate; avoids arguing tolerance post-hoc.

## R3: Dependency map

- **Decision**: enumerate surfaces needing the incumbent credential:
  backlinks (overview/profile/dashboard widgets), AI visibility
  (scheduled + manual + prompt research), local SEO MCP tools + UI,
  domain overview/ranked keywords/competitors, free tools on the
  marketing site (labs-backed), volume for labs/ads markets until
  feature 006's provider is configured.
- **Rationale**: FR-003 requires 100% coverage; the map lives as a
  contract doc so the audit is checklist-driven.
- **Alternatives considered**: error-banner middleware (rejected —
  screens deserve real empty states with setup links, not a global
  banner).

## R4: Preflight copy

- **Decision**: preflight splits "rank tracking" availability (fleet
  keys) from "backlinks & AI data" availability (incumbent key).
- **Rationale**: SC-001 — no incumbent-implied breakage warnings for
  tracking; operators see two independent capabilities.

## R5: Marketing site free tools

- **Decision**: free tools backed by Labs keep requiring the incumbent
  (they are web-marketing surfaces, out of the tracking exit path); their
  docs note the dependency. Replacing them is a separate future decision.
- **Rationale**: scope discipline — the exit's user story is rank
  tracking; free tools have no new providers to switch to.
