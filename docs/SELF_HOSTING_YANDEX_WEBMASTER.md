# Self-hosted Yandex Webmaster

Connecting Yandex Webmaster lets OpenSEO pull your site's Yandex search
performance (impressions, clicks, positions per query), the Yandex quality
index (SQI), and indexing counts, straight from Yandex.

It's **optional**: OpenSEO runs fine without it, just without Yandex data.

> These variables are separate from `YANDEX_SEARCH_API_KEY` — that key belongs
> to the Yandex Search API rank-tracking provider and cannot be used here.
> Webmaster access is OAuth-only.

## What you'll need

- A Yandex account with your site **verified** in
  [Yandex Webmaster](https://webmaster.yandex.ru).
- ~10 minutes at [oauth.yandex.ru](https://oauth.yandex.ru).
- Three environment variables set on your deployment (see
  [step 3](#3-set-environment-variables)).

## 1) Register an OAuth app

At [oauth.yandex.ru/client/new](https://oauth.yandex.ru/client/new):

1. **Platform: "Web services"** (`Веб-сервисы`). This is the only app type that
   accepts your own redirect URI; the type is permanent, so picking the debug
   type means starting over.
2. **Redirect URI**: your deployment's origin plus
   `/api/yandex/oauth/callback`:

   | Deployment   | Redirect URI                                                |
   | ------------ | ----------------------------------------------------------- |
   | Deployed     | `https://your-openseo-domain.com/api/yandex/oauth/callback` |
   | Local Docker | `http://localhost:3001/api/yandex/oauth/callback`           |

3. **Permissions**: check both, under "Yandex Webmaster" (`Вебмастер`):
   - `webmaster:hostinfo` — Доступ к информации о сайтах (site list)
   - `webmaster:verify` — Подтверждение сайтов

   Heads-up: the names are misleading. `hostinfo` alone only lists sites —
   **every data endpoint (queries, SQI, summary) requires `webmaster:verify`**.
   Yandex offers no read-only data scope, so "read-only" cannot be promised to
   users of a shared deployment. OpenSEO itself only reads.

4. Save and copy the **ClientID** and **Client secret** (`Секрет клиента`).

## 2) Verify a site in Yandex Webmaster

Only sites verified in the connecting Yandex account are selectable. If the
site is not in [webmaster.yandex.ru](https://webmaster.yandex.ru) yet, add and
verify it there first.

## 3) Set environment variables

Set these three values, then restart OpenSEO:

| Variable                     | Value                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| `YANDEX_OAUTH_CLIENT_ID`     | ClientID from step 1.                                                   |
| `YANDEX_OAUTH_CLIENT_SECRET` | Client secret from step 1.                                              |
| `BETTER_AUTH_SECRET`         | A random string of **at least 32 characters** (encrypts stored tokens). |

Startup logs and `/api/health` show the integration's status under
**"Yandex Webmaster (OAuth)"**: `Configured`, a warning when only one of the
two variables is set or the secret is too short, or `Not configured (optional)`
when unset.

## 4) Connect a project

Project → **Settings → Integrations → Yandex Webmaster** → **Connect**: approve
Yandex's permissions, then pick one of the account's verified sites. The
project's **Search Performance** page gains a **Yandex** tab with the popular
queries table and site summary.

## Notes and limits

- Yandex grants expire together with their refresh tokens (Yandex rotates the
  refresh token on every renewal). OpenSEO renews tokens as they near expiry
  while in use; a connection left unused past its expiry asks for a reconnect.
- Query data comes from Yandex's popular-queries pool (top ~3000 queries, 500
  per request) and finalizes ~4 days late; totals are floors, CTR is derived,
  and there is no query-to-page join or previous-period comparison. The UI and
  the `get_yandex_search_performance` MCP tool state these limits.
- Revoking the app on oauth.yandex.ru immediately breaks existing connections;
  users then see a reconnect prompt.
