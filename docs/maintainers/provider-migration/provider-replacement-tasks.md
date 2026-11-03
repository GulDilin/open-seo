# Замена DataForSeo: план задач

Основан на `provider-replacement-decisions.md`. Фазы идут строго по порядку;
задачи внутри фазы можно делать параллельно, если не указана зависимость.
Каждая задача = один небольшой PR. Формат: файлы → шаги → критерий готовности.

Общие правила для всех задач: миграции в двух диалектах (pg + sqlite), Zod на
входах, тесты через публичную точку входа (адаптер/сервис), без моков
ORM-цепочек. Изменения MCP-инструментов: после правки описаний запустить
`pnpm sync-plugin-skills` (bump версии плагина не нужен — меняются schema/
описания существующих инструментов, новых инструментов не добавляем).

---

## Фаза 0 — Фундамент (без изменения поведения) — ВЫПОЛНЕНО (2026-10-21)

### T0.1 Провайдерская конфигурация env
Файлы: `src/server/lib/runtime-env.ts`, `src/lib/selfhost-preflight.ts`,
`.env.example`, `web/.env.example`, `docs/SELF_HOSTING_*.md` (кратко).
Шаги:
1. Добавить чтение `SERPER_API_KEY`, `YANDEX_SEARCH_API_KEY`,
   `YANDEX_FOLDER_ID`, `BRIGHTDATA_API_TOKEN` (все опциональные).
2. Preflight: показывать статус каждого провайдера («настроен / нет») рядом с
   DataForSeo-ключом, без ошибки при отсутствии.
Готово, когда: без переменных всё работает как раньше; с переменными
preflight их показывает.

### T0.2 Каркас провайдерского слоя
Файлы: `src/server/lib/seo-providers/types.ts`, `routing.ts`;
`src/shared/search-engines.ts` (новый).
Шаги:
1. `types.ts`: `SearchEngine`, `SerpRankCheck`, `SerpRankResult`,
   `SerpProvider`, `KeywordVolumeQuery/Row`, `KeywordDataProvider` — по
   эскизу из decisions §3.2.
2. `src/shared/search-engines.ts`: `SERP_PROVIDER_CHAIN`, таблица
   доступности engine×страна (`RU → yandex,google`, `CN → baidu`,
   `NO → google,bing`, дефолт остальных — `google`), Zod-схема
   `searchEngineField` для переиспользования в формах.
3. `routing.ts`: `resolveSerpProvider(engine, country)` — каркас, который
   пока возвращает только dataforseo-заглушку для google и `null` для
   остальных; `isEngineAvailableForCountry()`.
Готово, когда: типы компилируются, unit-тесты на таблицу доступности
(существующий стиль `keyword-locations.test.ts`).

---

## Фаза 1 — Доменная модель трекинга — ВЫПОЛНЕНО (2026-10-21)

### T1.1 `search_engine` в схеме и миграции (зависит: T0.2)
Файлы: `src/db/app.schema.ts`, зеркала `src/db/pg/`, новая миграция pg
(`drizzle/pg/0038_*`) + sqlite (`drizzle/sqlite/0060_*`),
`src/types/schemas/rank-tracking.ts`.
Шаги:
1. Колонка `searchEngine text not null default 'google'` в
   `rank_tracking_configs`; пересобрать оба partial unique-индекса из
   `0006_location_name.sql` с включённым engine (drop + create в миграции).
2. Zod: `searchEngineField` в схемы create/update трекера; валидация против
   таблицы доступности по стране.
3. `locationName` оставить nullable — провайдеры без саб-страновых реестров
   его игнорируют (валидация локаций Яндекса — в T3.3).
Готово, когда: миграция применяется в обеих диалектах (локально pg + sqlite),
создание/обновление трекера принимает engine, старые трекеры читаются как
google, уникальные индексы не пускают дубль (project, domain, location,
engine, locationName).

### T1.2 РФ и Китай в списке рынков (зависит: T0.2)
Файлы: `src/shared/keyword-locations.ts`, тесты рядом.
Шаги:
1. Россия: `{ code: 643, label: "Russia", shortLabel: "RU", languageCode:
   "ru", serpEngines: ["yandex", "google"], keywordProvider: "wordstat" }`;
   Китай: `{ code: 156, ..., serpEngines: ["baidu"], keywordProvider: "none" }`
   — расширить тип записи полями доступных движков (дефолт `["google"]`).
2. `getKeywordDataProvider(643) → "wordstat"`, `(156) → "none"`; routing-тесты
   обновить. Комментарий-шапку файла поправить (больше не только DataForSeo
   коды).
3. Норвегию проверить в списке (2057, `google` + добавить `bing` в
   serpEngines).
Готово, когда: РФ/Китай выбираются в пикерах проектов, тесты таблицы зелёные.

### T1.3 UI и MCP: выбор движка у трекера (зависит: T1.1, T1.2)
Файлы: UI создания/редактирования трекера (по образцу текущего пикера
локации), `src/server/mcp/tools/create-rank-tracker.ts`, `get-rank-tracker.ts`,
`estimate-rank-tracker-cost.ts`.
Шаги:
1. Селект «Поисковик» рядом со страной; опции фильтруются по стране
   (`isEngineAvailableForCountry`).
2. MCP: опциональный `searchEngine` (default `google`) в input-schemas;
   описание инструмента упоминает yandex/baidu/bing.
3. Оценка стоимости: для не-dataforseo провайдеров показывать «цены
   провайдера» (константы из routing, без Autumn-кредитов).
Готово, когда: e2e вручную — трекер с engine=yandex создан (пока падает на
отсутствии провайдера с понятной ошибкой), google-трекер работает как раньше.
`pnpm sync-plugin-skills`.

---

## Фаза 2 — Serper (Google), первый живой провайдер — ВЫПОЛНЕНО (2026-10-21)

### T2.1 HTTP-клиент Serper (зависит: T0.1, T0.2)
Файлы: `src/server/lib/seo-providers/serper/client.ts`, `adapter.ts`,
тесты `serper/serper.test.ts`.
Шаги:
1. Клиент: POST `https://google.serper.dev/search`, `Authorization: X-API-KEY`,
   параметры `q`, `gl` (ISO alpha-2 из `getIsoCountryCode`), `hl`, `num=100`,
   `device`. Разбор: `organic[].position/link/title`.
2. Адаптер `SerpProvider`: `checkRank` — матчинг `targetDomain` по хосту с
   поддоменами; `topResults` — первые N органики. Никаких retry на 4xx,
   1 retry на 5xx/timeout.
3. Тесты: фикстура реального ответа Serper (обрезанная), проверка матчинга
   домена/поддомена, не-найдено → `position: null`.
Готово, когда: unit-тесты зелёные; ручной вызов с реальным ключом по
`q=тест gl=no` возвращает позиции.

### T2.2 Интеграция в rank tracking (зависит: T2.1, T1.3)
Файлы: `src/server/workflows/RankCheckWorkflow.ts`, `rankCheckPaths.ts`,
`src/server/features/rank-tracking/services/RankTrackingService.ts`,
`scheduledRankChecks.ts`.
Шаги:
1. В точке выбора live/queue: если engine ≠ google или провайдер chain
   выбрал не-dataforseo → путь нового провайдера (только live; очередей у
   Serper нет — `num=100` один запрос).
2. Результат писать в существующую таблицу результатов, не различая
   провайдера (позиция/url уже нейтральны); source хранить в существующем
   поле меты прогона, если оно есть, иначе не хранить вовсе.
3. `scheduledRankChecks`: бюджет-юниты — google через Serper считается 1
   юнитом за ключ (сейчас юниты DataForSeo-задач); лимит оставить общий.
4. Ошибки провайдера → `AppError("UPSTREAM_UNAVAILABLE")` с id провайдера в
   сообщении, чтобы skip-причины трекера были внятными.
Готово, когда: google-трекер с настроенным `SERPER_API_KEY` пишет позиции
через Serper; без ключа — через DataForSeo как раньше; scheduled прогон двух
трекеров (serper + dataforseo) в одном тике проходит в бюджете.

### T2.3 SERP-анализ ключа через Serper (зависит: T2.1; опционально по срокам)
Файлы: `src/server/features/keywords/services/research/serp.ts`.
Шаги: если engine google и Serper сконфигурирован — снимок выдачи из Serper
(organic + places) с тем же R2-кэшем; иначе текущий путь. Схема снимка —
внутренняя (существующая), маппинг в адаптере.
Готово, когда: SERP-панель исследования показывает выдачу без DataForSeo при
настроенном Serper.

---

## Фаза 3 — Яндекс (РФ): SERP + Wordstat — ядро выполнено (2026-10-21; регионы-UI и deferred — открытые срезы)

### T3.1 HTTP-клиент Yandex Search API (зависит: T0.1)
Файлы: `src/server/lib/seo-providers/yandex/client.ts`, тесты.
Шаги:
1. Авторизация: API-ключ (`YANDEX_SEARCH_API_KEY`) + `folder_id` в заголовках
   (точные имена заголовков — по актуальной доке Search API на момент
   реализации; зафиксировать в комментарии клиентом).
2. Синхронный поиск (одна проверка позиции) и отложенный batch (submit +
   poll результатов) — два метода; регионы через `lr`/id региона.
3. Wordstat: `GetTop`, `GetDynamics`, `GetRegionsTree` (кэш в KV
   `yandex-regions`, TTL 30 дней, по образцу `serp-locations.ts`).
4. Тесты на фикстурах ответов; retry только на идемпотентных чтениях.
Готово, когда: клиент возвращает органику выдачи и Wordstat-объёмы на
реальном ключе по 2–3 опорным ключам.

### T3.2 Адаптер SerpProvider для Яндекса (зависит: T3.1, T1.3)
Файлы: `src/server/lib/seo-providers/yandex/adapter.ts`,
`routing.ts` (включить yandex), интеграция в workflow из T2.2 (обобщить на
chain: google→serper/dataforseo, yandex→yandex).
Шаги:
1. `checkRank`: ручные прогоны — sync; scheduled — отложенный batch (дешевле
   в 16 раз), poll в том же тике планировщика.
2. Матчинг домена — как в T2.1.
3. E2E-сверка: 5 ключей в Москве (lr=213) против ручной выдачи yandex.ru —
   позиции совпадают в ±1 (гео-колебания допустимы, фиксируем допуск в
   тест-чеклисте).
Готово, когда: трекер engine=yandex, country=RU выполняется end-to-end и
пишет историю позиций.

### T3.3 Wordstat как KeywordDataProvider (зависит: T3.1, T1.2)
Файлы: `src/server/lib/seo-providers/yandex/wordstat.ts`,
`routing.ts` (keyword chain), `src/server/features/keywords/services/research/`
(research-data, local-volume аналоги), `refresh-metrics.ts`.
Шаги:
1. `getVolumes` для страны RU: volume из `GetTop`, остальное null,
   `source: "wordstat"`.
2. Подключить в research для РФ (вместо Labs/GoogleAds-веток): у РФ нет
   Labs — список ключей из Wordstat `GetTop` (хвосты запроса) + Serper
   снимок; KD/intent показывать как недоступные (паттерн googleAdsOnly).
3. `refresh-metrics` для сохранённых ключей РФ — Wordstat.
Готово, когда: исследование по РФ-рынку выдаёт список ключей с объёмами
Wordstat; сохранённые ключи РФ обновляют объёмы по расписанию/кнопке.

---

## Фаза 4 — Baidu и Bing через Bright Data — ВЫПОЛНЕНО (2026-10-22)

### T4.1 Клиент и адаптер Bright Data SERP
Файлы: `src/server/lib/seo-providers/brightdata/client.ts`, `adapter.ts`.
Шаги: обёртка их SERP API (`engine=baidu|bing`, гео-параметры), адаптер по
образцу T2.1, включение в routing. E2E-сверка позиций Baidu по 3–5 ключам.
Готово, когда: трекер engine=baidu (CN) и engine=bing (NO) пишут позиции.

---

## Фаза 5 — Объёмы прочих стран и Vitals (опционально, после трекинга)

### T5.1 KeywordDataProvider для не-РФ рынков — Google Ads API (BYO) — ВЫПОЛНЕНО (2026-10-22)
После повторного исследования рынка (запрос мейнтейнера): прямой Google Ads
API легален для self-hosted собственного использования, бесплатен, покрывает
~200 стран. Реализовано: провайдер google-ads (refresh-token OAuth →
generateKeywordIdeas), честные null по CPC/KD, fallback в keyword-metrics
при отсутствии ключа DataForSeo. Ahrefs/Semrush остаются отклонёнными;
Keywords Everywhere ($7/мес) — задокументированный запасной вариант без
реализации. Хвост: список идей (ideas) для labs-рынков без DataForSeo.

### T5.2 Lighthouse → Google PageSpeed Insights — ВЫПОЛНЕНО (2026-10-22)
Файлы: `src/server/lib/audit/lighthouse.ts`.
Заменить вызов `on_page/lighthouse` на PSI API (бесплатный, `lighthouseResult`),
нормализация в существующий `StoredLighthousePayload`. Если DataForSeo ещё
используется другими ролями — просто переключить источник, env не менять.

---

## Фаза 6 — Вывод DataForSeo из SERP-пути

### T6.1 Google-позиции полностью на Serper (зависит: 2 недели параллельной
эксплуатации T2.2 без инцидентов)
Шаги: убрать dataforseo из `SERP_PROVIDER_CHAIN.google` (оставить как
fallback при отсутствии ключа Serper — решить по своим заказчикам; для
self-host-форка проще жёстко: только serper). Обновить estimate-cost и доки.

### T6.2 Решение по оставшимся ролям DataForSeo
Backlinks, AI Visibility, Local SEO, Labs domain overview: для каждой роли —
отдельное мини-решение (Ahrefs / оставить / отключить в форке). Не начинать,
пока трекинг всех рынков заказчиков не стабилен.

---

## Контрольные точки

| Точка | Критерий |
| --- | --- |
| После Фазы 2 | Google-позиции любого рынка без DataForSeo-ключа (только Serper) |
| После Фазы 3 | РФ-трекинг end-to-end: Яндекс-позиции + Wordstat-объёмы, оплата в рублях |
| После Фазы 4 | CN (Baidu) и NO (Bing) трекинг живые |
| После Фазы 6 | `DATAFORSEO_API_KEY` не обязателен для работы rank tracking |

## Чего в плане сознательно нет

- Интерфейсов под Backlinks/AI/Local (второго провайдера нет — абстракция
  станет спекулятивной; заводим при появлении).
- Миграции `projects.location_code` на ISO (внутренний числовой код +
  `getIsoCountryCode()` достаточно).
- Hosted-биллинга новых провайдеров (self-host; потолок зафиксирован в
  decisions §3.6).
- 360/Sogou/Seznam и Baidu-метрик через 5118 (нет API-покрытия или юани;
  ограничение зафиксировано в decisions §6).
