# Data Model: Yandex Webmaster Integration

## Entities

### Yandex grant (existing table, new provider row)

Better Auth `account` row with `provider_id = "yandex-webmaster"`:

| Column | Value |
|---|---|
| `account_id` | Yandex Webmaster `user_id` (uid, from `GET /v4/user`), stored as text |
| `user_id` | the OpenSEO member who consented |
| `access_token` / `refresh_token` | encrypted with BETTER_AUTH_SECRET (same crypto as Google grants) |
| `access_token_expires_at` | issue time + `expires_in` |
| `scope` | `webmaster:hostinfo,webmaster:verify` |

Invariants: one row per (user, uid); the refresh token is re-encrypted and
persisted on every refresh (Yandex rotates it); no foreign keys — keyed lookups
by (user_id, provider_id, account_id) like the Google grants.

### yandex_connections (new table, both dialects)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | uuid |
| `project_id` | text NOT NULL | FK → projects, cascade; **unique** — one Yandex site per project |
| `organization_id` | text NOT NULL | FK → organization, cascade |
| `host_id` | text NOT NULL | Yandex Webmaster opaque site id (e.g. `https:example.com:443`); never derived from a URL |
| `host_url` | text NOT NULL | `ascii_host_url` as listed by Yandex, for display |
| `connected_by_user_id` | text NOT NULL | whose yandex-webmaster grant API calls use |
| `yandex_account_id` | text | uid of the grant used at connect time |
| `created_at` / `updated_at` | timestamp defaults | dialect-specific defaults (sqlite `current_timestamp`, pg ISO text) |

Relationships: many-to-one with `projects` (unique), `organization`, and the
Better Auth `account` rows via (`connected_by_user_id`, `yandex_account_id`).
Normalized per Constitution III — no JSON payloads; the grant itself lives in
the existing account table, only the project mapping lives here.

State transitions: absent → upsert on site select → replaced on re-select
(same row updated) → deleted on disconnect. No other states.

## Validation rules

- `host_id` must come from the connector's own `hosts` list at select time
  (server re-lists and matches; never trusts a client-supplied host_id alone).
- Only `verified: true` hosts are selectable.
- Every Yandex API response is Zod-parsed in the adapter before any field is
  stored or returned (indicators are optional — a query row without
  `AVG_SHOW_POSITION` is valid).
