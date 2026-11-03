# Замена DataForSeo: документ решений

Статус: принято для форка (октябрь 2026). Документ описывает архитектуру
провайдерского слоя, выбор сервисов для каждой роли данных и решения по
РФ/Яндексу. Последовательность работ — в `provider-replacement-tasks.md`.

## 1. Почему уходим от DataForSeo

| Проблема | Факт |
| --- | --- |
| РФ отключена вендором | DataForSeo удалила Россию (643) и Беларусь из всех API 07.03.2022, РФ-аккаунты не обслуживаются, РФ — restricted jurisdiction в их ToS. РФ-метрики невозможны ни при какой настройке. |
| Google-only в коде | Весь SERP-слой — `/v3/serp/google/*`; поля «поисковик» нет ни в API, ни в БД. Яндекс/Baidu/Bing не поддерживаются. |
| Вендор-lock системы координат | Числовые `location_code` DataForSeo в БД (`projects`, `saved_keywords`, `keyword_metrics`, `rank_tracking_configs`, `ai_visibility`) и hardcoded-список стран без РФ и Китая. |
| Wire-форматы в домене | DataForSeo item-типы (snake_case) импортируют 45 файлов за пределами либы; filter DSL (`["rank,desc"]`) строится в фичевых сервисах. |

Требования: rank tracking для заказчиков в Норвегии (Google/Bing), Китае
(Baidu), РФ (Яндекс); keyword volume по РФ; self-host (метринг отключён —
биллинг Autumn в миграции не участвует).

## 2. Принципы

1. **Strangler fig, не big-bang.** DataForSeo остаётся дефолтом для Google и
   западных стран, пока новые провайдеры не покроют путь rank tracking
   полностью. Вывод — последняя фаза, отдельным решением.
2. **Общие API = интерфейсы по роли данных**, а не универсальный
   `DataProvider`. Роли: позиции/выдача (`SerpProvider`), частотности
   (`KeywordDataProvider`). Бэклинки, Lighthouse и AI — свои точки решения
   (см. §7–9), интерфейс для них заводим только когда появится второй
   провайдер.
3. **Нормализация на границе.** Адаптер возвращает внутренние camelCase-типы;
   wire-формат сервиса не покидает свой модуль. Существующие нормализаторы
   (`KeywordMetricRow`, `RankCheckResult`, `backlinksRowMappers`) — образец.
4. **Координаты: engine + ISO-страна + язык.** Канонический ключ рынка —
   числовой код из `keyword-locations.ts` (для стран DataForSeo совпадает с
   их кодами; для новых стран берём ISO 3166-1 numeric: Россия 643, Китай
   156). ISO alpha-2 для провайдеров выводим через существующий
   `getIsoCountryCode()`.
5. **Dual-dialect миграции.** Каждое изменение схемы — для pg и sqlite
   (AGENTS.md). Zod на всех входах.
6. **Routing по (engine, country)** — таблица провайдеров в порядке
   приоритета, первый сконфигурированный. Паттерн уже существует:
   `getKeywordDataProvider()` для labs↔google_ads.

## 3. Целевая архитектура

### 3.1 Директория

```
src/server/lib/seo-providers/
  types.ts          # интерфейсы SerpProvider / KeywordDataProvider + нормализованные типы
  routing.ts        # resolveSerpProvider(engine, country): SerpProvider | null
  serper/           # Google: позиции + снимки выдачи
  yandex/           # Yandex Search API (SERP) + Wordstat (частотности)
  brightdata/       # Bing + Baidu (фаза 4)
  dataforseo/       # тонкий адаптер над существующей src/server/lib/dataforseo
```

Существующая `src/server/lib/dataforseo` не трогается — адаптер вызывает её
функции (`fetchLiveSerp`, `fetchRankCheckSerp`) и нормализует результат.

### 3.2 Интерфейсы (`types.ts`, эскиз)

```ts
export type SearchEngine = "google" | "yandex" | "baidu" | "bing";

export interface SerpRankCheck {
  keyword: string;
  engine: SearchEngine;
  country: string;      // ISO 3166-1 alpha-2
  language: string;     // ISO 639-1 (как в текущем pickers)
  region?: string;      // регион/город; для Яндекса — id региона из GetRegionsTree
  device: "desktop" | "mobile";
  targetDomain: string;
  depth: number;        // 10..100
}

export interface SerpRankResult {
  position: number | null; // 1-based среди органики; null = не найден
  url: string | null;
  topResults: Array<{
    position: number;
    domain: string;
    url: string;
    title: string;
  }>;
}

export interface SerpProvider {
  readonly id: "serper" | "yandex" | "brightdata" | "dataforseo";
  readonly engines: readonly SearchEngine[];
  isConfigured(): boolean;
  checkRank(input: SerpRankCheck): Promise<SerpRankResult>;
}

export interface KeywordVolumeQuery {
  keyword: string;
  country: string; // ISO alpha-2
  language: string;
  region?: string;
}

export interface KeywordVolumeRow {
  keyword: string;
  volume: number | null;      // показов/мес
  cpc: number | null;         // null у wordstat
  competition: number | null; // 0..1, null у wordstat
  difficulty: number | null;  // null у wordstat (как googleAdsOnly-страны)
  source: "wordstat" | "dataforseo" | "ahrefs";
}

export interface KeywordDataProvider {
  getVolumes(queries: KeywordVolumeQuery[]): Promise<KeywordVolumeRow[]>;
}
```

### 3.3 Routing

Таблица живёт в `src/shared` (нужна и UI для пикеров, и серверу):

```ts
// engine → провайдеры в порядке приоритета
export const SERP_PROVIDER_CHAIN: Record<SearchEngine, ProviderId[]> = {
  google:  ["serper", "dataforseo"],
  yandex:  ["yandex"],
  baidu:   ["brightdata"],
  bing:    ["brightdata"],
};
```

`resolveSerpProvider()` возвращает первый провайдер с `isConfigured()`;
если настроенных нет — понятная ошибка с перечнем нужных env. Никаких
автоматических подмен движков: запрос «yandex» не молчит в Google.

Доступность engine по стране — тоже в shared (`RU → yandex, google`,
`CN → baidu`, `NO → google, bing`), чтобы UI-пикер и MCP-валидация не
расходились с сервером.

### 3.4 Конфигурация

| Переменная | Провайдер | Формат |
| --- | --- | --- |
| `SERPER_API_KEY` | Serper | ключ из дашборда serper.dev |
| `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID` | Yandex Search API | API-ключ сервисного аккаунта в Яндекс Облаке + id каталога |
| `BRIGHTDATA_API_TOKEN` | Bright Data SERP API | токен из панели |

Все — опциональные; отсутствие = провайдер не сконфигурирован. Обновить
`runtime-env.ts`, `selfhost-preflight.ts`, `.env.example`, self-hosting доки.
`DATAFORSEO_API_KEY` остаётся до фазы вывода.

### 3.5 Схема БД

- `rank_tracking_configs`: колонка `search_engine text not null default
  'google'`; включить в оба partial unique-индекса из миграции
  `0006_location_name.sql` (национальный: + engine; локальный: + engine).
  Миграции в `drizzle/pg/0038_*` и `drizzle/sqlite/0060_*` (номера даст
  drizzle-kit; руками — одинаковая семантика в обоих диалектах).
- Существующие трекеры остаются `google` — обратной совместимости не
  требуется больше.
- Таблица результатов rank checks переиспользуется как есть (позиция/url уже
  провайдер-нейтральны); в результаты, где нужно различие, engine приходит из
  конфига.
- `projects.location_code` НЕ мигрируем: числовой код остаётся внутренним
  ключом рынка, ISO выводится. Для РФ/Китая добавляем записи с кодами
  643/156 (ISO numeric; в списке DataForSeo их нет, но таблица — наша).

### 3.6 Биллинг

Self-host: метринг отключён (`client.ts` — не-hosted ветка), новые провайдеры
платятся напрямую сервисам — в первую фазу ничего не делаем. Если форк когда-то
станет hosted: механика hold/settle Autumn провайдер-агностична, нужно только
добавить прайс-оценки в таблицу по образцу `pricing.ts`. Зафиксировано как
осознанное упрощение: `ponytail:`-потолок — hosted-режим новых провайдеров не
поддерживается до отдельной задачи.

## 4. РФ / Яндекс: решения

### 4.1 Основной путь — официальный Yandex Search API (Яндекс Облако)

Почему официальный API, а не скреперы: только он даёт настоящую региональную
выдачу Яндекса (геозависимость, `lr`-регионы) с РФ-выходов без капчи;
оплачивается в рублях.

- **SERP**: синхронный поиск ~488 ₽ / 1000 запросов (≈ 0,49 ₽ за проверку
  позиции), **отложенный ~30,5 ₽ / 1000** (≈ 0,03 ₽). Отложенный дешевле в
  ~16 раз → шаблон зеркалит DataForSeo `task_post`/`task_get`: scheduled
  прогоны — отложенные, ручные — синхронные.
- **Wordstat (частотности)**: `GetTop` (топ запросов + частотность, 20 ₽ /
  1000), `GetDynamics` (динамика, 20 ₽ / 1000), `GetRegionsDistribution`
  (50 ₽ / 1000), `GetRegionsTree` (бесплатно). REST/gRPC, синхронно.
- **Регионы**: дерево регионов из `GetRegionsTree`, кэш в KV по образцу
  `serp-locations.ts` (`yandex-regions`, TTL 30 дней). Локальный трекинг по
  РФ = id региона в `SerpRankCheck.region`.
- **Матчинг позиций**: organic items → сравнение домена с поддоменами, тот же
  принцип, что в `buildRankCheckResult` (`with_subdomains`).
- **Авторизация**: сервисный аккаунт Яндекс Облака, API-ключ + `folder_id`
  в заголовках. Точные маршруты/лимиты фиксируются в коде адаптера по
  актуальной доке aistudio.yandex.ru/docs/search-api.

### 4.2 Отклонённые альтернативы (и почему)

| Вариант | Вердикт | Причина |
| --- | --- | --- |
| Bright Data / SerpApi для Яндекса | ✗ | Нет прокси-выходов из РФ (Bright Data — официально исключённые страны), выдача без РФ-IP не релевантна/капчи |
| Мутаген API (950 ₽/мес) | ✗ для продукта | Обязательная атрибуция «данные получены из Мутагена» + запрет перепродажи в условиях API. Допустимо для личного использования, не для встраивания |
| Keys.so / Топвизор | ✗ как data-source | Это готовые инструменты с API к своим отчётам, а не сырые данные; оверлей поверх нашей логики |
| Serpstat | ✗ | Яндекс-баз больше нет |
| Парсинг Wordstat своими силами | ✗ | Капчи, прокси, хрупкость; официальный API дешевле сопровождения |

### 4.3 Частотности РФ в продукте

`KeywordVolumeRow` от Wordstat: `volume` — есть, `cpc/competition/difficulty`
— `null`, `source: "wordstat"`. UI и MCP-описания честно показывают отсутствие
KD/intent — тот же паттерн, что уже есть для `googleAdsOnly`-стран (спека
0004). Россия в `keyword-locations.ts` помечается как yandex/wordstat-страна.

## 5. Serper для Google

Роль: основной провайдер Google-позиций для всех стран (Норвегия в т.ч.),
замена `/v3/serp/google/organic` при выводе DataForSeo.

- **Тарифы**: 2500 запросов бесплатно при регистрации; $50 / 50 000 кредитов
  (≈ $1 / 1000 при 10 результатах); до $0.30 / 1000 на объёме. 100
  результатов за запрос = 2 кредита.
- **Rank tracking**: запрашиваем сразу `num=100` (~$2/1000) — дешевле и
  проще, чем постраничный обход; `stop_crawl_on_match`-оптимизация DataForSeo
  не нужна.
- **Покрытие**: organic, places (maps), news, images, scholar — хватает для
  позиций и SERP-анализа. Только Google-стек.
- **Ограничения**: не покрывает Bing/Baidu/Яндекс (для них Bright Data и
  Яндекс), не даёт keyword volume / backlinks / AI-данных.
- **Сравнение с DataForSeo**: их live organic ≈ $2/1000 и queue ≈ $1.2/1000 —
  Serper в паритете или дешевле, при этом не требует аккаунта DataForSeo
  вообще.

## 6. Baidu и Bing: Bright Data (фаза 4)

- 7 движков (Google, **Bing, Baidu**, Yandex, Naver, DuckDuckGo, Yahoo), 195
  стран, PAYG $1–1.5 / 1000, 5000 запросов/мес бесплатно.
- Оплата не из РФ напрямую (посредник/карта третьей страны), строгий KYC —
  заводить аккаунт на зарубежные реквизиты заказчика/компании.
- Sogou и 360 Search API не покрывает никто (частично 5118 для 360 — юаневые
  кредиты; вне скоупа, фиксируем как ограничение продукта).

## 7. Core Web Vitals: Google PageSpeed Insights API

Замена `/v3/on_page/lighthouse/live/json` — бесплатный PSI API (`pagespeedonline.googleapis.com`,
поле `lighthouseResult`). Тот же Lighthouse под капотом; нормализация в
существующий `StoredLighthousePayload`. Лимит PSI ~25k/день — достаточно для
аудита. Фон для фазы 5, не блокирует трекинг.

## 8. Keyword volume прочих стран — Google Ads API (BYO)

Решение пересмотрено 2026-10-22 после повторного исследования рынка.

- **Основной источник объёмов для всех не-РФ рынков — Google Ads API
  напрямую** (`KeywordPlanIdeaService.generateKeywordIdeas`): бесплатно,
  первоисточник (те же данные Keyword Planner, из которых их берут
  DataForSeo/Ahrefs), покрывает ~200 стран включая Норвегию.
- **Юридическая рамка (проверено по первоисточникам, сентябрь–октябрь
  2026):** запрет проксирования «secondary API / wrapper / MCP server»
  прямо не ограничивает собственное использование API; обязательные
  требования к функциональности не применяются к internal-use tools;
  базовый уровень доступа бесплатен, одобряется автоматически на
  Cloud-проект (15 000 операций/день; запрос объёмов по 1000 ключей =
  1 операция). По этому пути годами работают Keywords Everywhere и
  Keyword Tool.
- **Архитектурное требование BYO-кред:** каждый оператор форка
  подключает СВОЙ Google Cloud-проект и Ads-аккаунт
  (`GOOGLE_ADS_CUSTOMER_ID` + `GOOGLE_ADS_REFRESH_TOKEN`; client
  id/secret — существующие `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`).
  Общий токен проекта для чужих пользователей запрещён политикой —
  форк его не использует.
- **Приоритет routing:** для labs/google_ads-рынков объёмы остаются на
  DataForSeo, пока его ключ настроен; Google Ads API включается как
  замена, когда ключа DataForSeo нет. РФ — Wordstat (§4), Китай — честно
  недоступно.
- **Известные ограничения:** объёмы приходят «бакетами» (10/100/1000…)
  без рекламных расходов на аккаунте — достаточно для ранжирования идей;
  CPC в ideas-эндпоинте нет → `cpc: null`; competition — категориальный
  enum (LOW/MEDIUM/HIGH) → `null` по правилу «не выдумывать шкалу»;
  keyword difficulty и intent у Google нет вообще.
- **Запасной вариант** (лимиты Google исчерпаны): Keywords Everywhere
  ($7/мес, ~$0.0001/ключ, тот же первоисточник KP) — не реализуется,
  пока не понадобится.
- **Ahrefs/Semrush API отклонены** (решение мейнтейнера, 2026-10-21):
  проект — их открытая альтернатива; подписка конкурентам противоречит
  назначению форка. Это же закрывает их как путь для бэклинков и domain
  overview (§9). Serpstat (собственный индекс, не из исключённой пары)
  оставлен как возможное будущее решение по доменам/конкурентам —
  мейнтейнер не запрашивал.

## 9. Что остаётся на DataForSeo (до отдельного решения о полном выводе)

Backlinks (`backlinks/*`), AI Optimization (`ai_optimization/*`), Business
Data / Local SEO (`business_data/*`), Labs для domain overview и западного
keyword research. Вывод этих ролей — свой проект каждая; при этом
подписные SEO-суиты-конкуренты (Ahrefs, Semrush) как источники исключены
в принципе: форк — их открытая альтернатива. AI-видимость заменяется
собственным сбором (см. отдельное решение по llm_mentions). Критерий
полного вывода DataForSeo из SERP-пути: Serper покрывает google,
Яндекс — свой адаптер, Baidu/Bing — Bright Data, и каждая роль прошла
параллельную эксплуатацию.

## 10. Риски

| Риск | Смягчение |
| --- | --- |
| ToS/блокировка Serper/Bright Data аккаунтов | Официальные API продуктов, а не парсинг; для Bright Data — аккаунт на чистые реквизиты; routing позволяет заменить провайдера без изменения фич |
| Лимиты Яндекса (RPS, квоты каталога) | Отложенные запросы для scheduled; бюджет-юниты в `scheduledRankChecks` расширены на провайдеров |
| Google-глубина > 100 у Serper | Ограничить `serpDepth` ≤ 100 для не-dataforseo провайдеров в валидации (глубже 100 — редкий кейс, фиксируем лимитом) |
| Дрейф качества выдачи (гео, язык) | E2E-сверка выборочных ключей при подключении каждого адаптера (критерий приёмки в задачах) |
| Разлад UI/серверной доступности engine | Таблица доступности в `src/shared`, обе стороны читают её |
