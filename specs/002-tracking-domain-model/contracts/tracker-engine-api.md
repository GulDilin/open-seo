# Contract: Tracker engine surface

The interfaces exposed by this feature to UI and MCP consumers.

## Server function / service input (create tracker)

```ts
{
  projectId: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  locationName?: string;
  searchEngine?: "google" | "yandex" | "baidu" | "bing";  // default "google"
  ...
}
```

Validation error (example):

```
VALIDATION_ERROR: engine "baidu" is not offered for this market;
supported: google, bing
```

## Tracker output shape (UI + MCP)

```ts
{
  id: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  searchEngine: "google" | "yandex" | "baidu" | "bing";
  ...
}
```

`searchEngine` is always present (never null) in every read path.

## MCP tools

- `create_rank_tracker`: optional `searchEngine` (enum, default google);
  rejected values list supported engines for the chosen market.
- `get_rank_tracker` / list surfaces: include `searchEngine`.
- `estimate_rank_tracker_cost`: for non-google engines returns a
  provider-priced note (no credit estimate) until provider phases land.

## Non-Google tracker first check (until features 003–005)

Status recorded on the tracker: failed check with reason
`PROVIDER_NOT_CONFIGURED` naming the engine and the credential variable(s)
from feature 001's resolver error. The tracker remains schedulable; every
check retries resolution first.
