# Contract: Bright Data adapter

Implements `SerpProvider` for engines `baidu` and `bing`.

## Request mapping

| Internal | Bright Data |
| --- | --- |
| engine baidu/bing | engine parameter |
| country (ISO alpha-2) | geo country parameter |
| language | language parameter |
| device | device parameter if supported per engine (recorded at integration; else fixed desktop) |
| depth | clamped per engine max; clamp notice |

## Response contract

Validated organic list → `{position (or index+1), url, title, domain from
host}`. Same matching rule as Serper/Yandex: host equals target or ends
with "."+target; organic only.

## Error contract

Identical to feature 003's table with `providerId: "brightdata"`.

## Preconditions

- Engine ∈ {baidu, bing} asserted before network (never a paid call for
  another engine's request routed here).
- Market availability already enforced upstream (feature 002); adapter
  trusts but re-asserts engine.
