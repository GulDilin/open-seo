---
title: "Docker Self-Hosting"
description: "Run OpenSEO locally with Docker Compose using the published GHCR image."
---

Run OpenSEO locally with Docker.

In Docker mode, OpenSEO uses `AUTH_MODE=local_noauth` (no auth checks, local admin user `admin@localhost`). Only expose it behind your own auth-protected reverse proxy, tunnel, or private network — or switch to real OpenID Connect sign-in with [`AUTH_MODE=oauth`](#oauth-sign-in-auth_modeoauth). For internet-facing self-hosting with a managed login gate, use [Cloudflare](/docs/self-hosting/cloudflare) instead.

The default `compose.yaml` uses the published GHCR image:

- `ghcr.io/every-app/open-seo:latest`

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Docker Compose)
- A [DataForSEO API key](/docs/self-hosting#dataforseo-api-key-setup)

## Quickstart

Clone the repo, then:

```bash
git clone https://github.com/every-app/open-seo.git
cd open-seo
cp .env.example .env
```

Set `DATAFORSEO_API_KEY` in `.env` using the [DataForSEO setup guide](/docs/self-hosting#dataforseo-api-key-setup), then start OpenSEO:

```bash
docker compose up -d
```

Open `http://localhost:<PORT>` (default `3001`). Each container start builds the app and may take 1-2 minutes; follow progress with `docker compose logs -f`.

Optional env values:

- `PORT` (defaults to `3001`)
- `ALLOWED_HOST` (single reverse-proxy hostname to allow in Vite preview)
- `AUTH_MODE=local_noauth` (already set in compose)
- `OPEN_SEO_IMAGE` (defaults to `ghcr.io/every-app/open-seo:latest`)

AI Visibility uses your `DATAFORSEO_API_KEY` and sends tracked questions to DataForSEO. Set `OPENROUTER_API_KEY` for setup research, Prompt Research, and generated prompt suggestions. You pay providers directly; the app shows the collection cost before a check or schedule starts. Keep the container running for background answers and daily, weekly, or monthly tracking. The built-in scheduler checks for due work every five minutes; no host cron setup is required. See the [AI Visibility guide](/docs/ai-visibility).

If you are putting Docker behind a reverse proxy or a temporary tunnel, remember that Docker self-hosting runs with app auth disabled. Only expose it behind your own auth-protected reverse proxy, tunnel, or private network, and add the public hostname before restarting:

```bash
ALLOWED_HOST=yourdomain.com docker compose up -d
```

You can also persist it in `.env`.

## OAuth sign-in (`AUTH_MODE=oauth`)

`local_noauth` trusts everyone who reaches the container. `AUTH_MODE=oauth` turns on real sign-in against **any OpenID Connect provider you choose** — Keycloak, Authentik, Auth0, Okta, Dex, Zitadel, Google, or your own IdP — with one isolated workspace per account.

Set in `.env`:

```bash
AUTH_MODE=oauth
# The public origin of this instance (http://localhost:3001 works too)
BETTER_AUTH_URL=https://your-domain.example
# Random, 32+ characters: openssl rand -hex 32
BETTER_AUTH_SECRET=

# Your IdP's issuer base URL — authorization, token, and userinfo endpoints
# are discovered from <issuer>/.well-known/openid-configuration at runtime.
OAUTH_SIGNIN_ISSUER=https://idp.example.com/realms/main
# A client registered on the IdP with redirect URI
# <BETTER_AUTH_URL>/api/auth/oauth2/callback/sso
OAUTH_SIGNIN_CLIENT_ID=
OAUTH_SIGNIN_CLIENT_SECRET=
# Optional: space-separated scopes (default "openid profile email")
# OAUTH_SIGNIN_SCOPES=
```

Register a client on your IdP with the redirect URI
`<BETTER_AUTH_URL>/api/auth/oauth2/callback/sso`. Common issuer URLs:

| Provider | Issuer (`OAUTH_SIGNIN_ISSUER`) |
| --- | --- |
| Keycloak | `https://<host>/realms/<realm>` |
| Authentik | `https://<host>/application/o/<slug>` |
| Google | `https://accounts.google.com` |
| Auth0 | `https://<tenant>.<region>.auth0.com` |

Restart with `docker compose up -d`. The startup preflight names exactly what is missing when a value is absent, and the instance serves no data to anyone until the configuration is complete.

Requirements on the IdP: its userinfo (or id_token) must return the user's subject id (`sub`) and **email address** — the email is the account key, and doubles as the display name when the profile has no `name`/username field. An email missing from the profile is a refused sign-in, not an account without an address.

Whoever your IdP lets in can sign in — restrict that in the IdP's client policy; the instance itself accepts every account the IdP releases. MCP clients authenticate with an API key created in **Settings → Personal**.

Switching from `local_noauth` does not touch existing data: the local admin user and its projects stay in the database; switch the mode back to work on them again.

## Telemetry

OpenSEO collects anonymized telemetry for core usage events: heartbeats with aggregate counts (installs, users, projects, feature usage) tied to a random install ID, sent every 5 minutes during the first two hours after install, then at most once daily. Telemetry also includes failed setup check names and statuses, never values or error messages. No URLs, keywords, prompts, emails, or IP-derived location are collected, and idle installs send nothing.

Heartbeats are triggered by requests to the app or MCP server. Requests to `/api/health`, including Docker's automatic health checks, do not trigger telemetry.

To disable it, set `OPENSEO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in `.env`, then run `docker compose up -d --force-recreate open-seo`.

## Pin to a specific image tag

Set `OPEN_SEO_IMAGE` in `.env` and restart:

```bash
OPEN_SEO_IMAGE=ghcr.io/every-app/open-seo:v1.2.3
docker compose up -d
```

## Build your own image locally

If you are testing local code changes, build and run a local tag:

```bash
docker build -f deploy/docker/Dockerfile -t open-seo:local .
OPEN_SEO_IMAGE=open-seo:local docker compose up -d
```

## Common commands

Restart service after env changes:

```bash
docker compose up -d open-seo
```

Pull latest published image and restart:

```bash
docker compose pull && docker compose up -d
```

Stop:

```bash
docker compose down
```

## Health and troubleshooting

Startup checks appear in `docker compose logs` before the build. Once running, `/api/health` reports configuration and database status, and `docker compose ps` reports container health.

## Troubleshooting environment variables

To confirm Docker Compose is using the expected environment variables:

```bash
docker compose config
```

Check that `AUTH_MODE=local_noauth`, and that `DATAFORSEO_API_KEY` is the base64 encoded value of your DataForSEO email and API password in this format: `email:password`.

If you changed `.env`, recreate the container so Compose reapplies it:

```bash
docker compose up -d --force-recreate open-seo
```
