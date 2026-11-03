# Contract: Incumbent dependency map

Checklist of surfaces that MUST show a dependency state when
`DATAFORSEO_API_KEY` is absent (FR-003 audit basis), and the ones that
MUST NOT mention the incumbent.

## Requires incumbent credential (dependency state)

| Surface | Location (feature area) |
| --- | --- |
| Backlinks overview / profile / history | `features/backlinks` |
| Dashboard backlink widgets (new/lost links, referring domains) | `features/dashboard` |
| AI visibility: schedules, manual runs, prompt research | `features/ai-visibility` |
| AI search: brand lookup, share of voice, prompt explorer | `features/ai-search` |
| Local SEO MCP tools + UI (GBP info, reviews, Q&A, grids) | `mcp/tools/local-seo-*` |
| Domain overview / ranked keywords / relevant pages / SERP competitors | `features/domain` |
| Keyword research for labs/ads markets (until feature 006 provider active) | `features/keywords` |
| Marketing-site free tools (labs-backed) | `web/` free tools |

## Must NOT reference the incumbent

| Surface |
| --- |
| Rank tracker create/edit/list/run/history (all engines) |
| SERP snapshots via fleet providers |
| Russia research volumes (wordstat) |
| Site audit crawl + issues |
| Audit vitals (PSI, feature 006) |
| GSC / GA4 surfaces |
| Reports, IndexNow, project management |

## State contract (each dependency surface)

- Credential present: current behavior, byte-for-byte.
- Credential absent: explanatory empty state — names "DataForSeo" and
  `DATAFORSEO_API_KEY`, links to setup docs; stored/cached data stays
  visible; refresh actions disabled with the same explanation.
