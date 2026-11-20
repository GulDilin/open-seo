import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart } from "recharts";
import { Monitor, Smartphone } from "lucide-react";
import {
  getRankTrackingConfigSummaries,
  getRankProjectSummary,
  getRankProjectTrend,
  type RankProjectSummary,
} from "@/serverFunctions/rank-tracking";
import { QueryState } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { LOCATIONS } from "@/client/features/keywords/locations";
import { formatLocationLabel } from "@/shared/keyword-locations";
import {
  SEARCH_ENGINE_LABELS,
  SEARCH_ENGINES,
  type SearchEngine,
} from "@/shared/search-engines";
import {
  formatDateLabel,
  TIME_AXIS,
  TrendEmptyState,
  TrendRangeToggle,
} from "./RankTrackingTrendChart";

const BUCKETS = [
  { key: "top1", label: "Top 1", color: "#15803d" },
  { key: "top2to5", label: "2–5", color: "#16a34a" },
  { key: "top6to10", label: "6–10", color: "#2563eb" },
  { key: "top11to50", label: "11–50", color: "#f59e0b" },
  { key: "notInTop50", label: "Not in top 50", color: "#6b7280" },
  // Missing data, not a ranking: lighter fill so it doesn't read as lost
  // positions.
  {
    key: "notChecked",
    label: "Not checked",
    color: "#d1d5db",
    hint: "Check failed, no position recorded.",
  },
] as const;

const chartConfig: ChartConfig = Object.fromEntries(
  BUCKETS.map((b) => [b.key, { label: b.label, color: b.color }]),
);

// Sentinel for "no filter"; never leaves the component.
const ALL = "ALL";

function marketKeyOf(config: {
  locationCode: number;
  locationName: string | null;
}) {
  return `${config.locationCode}|${config.locationName ?? ""}`;
}

function marketLabel(locationCode: number, locationName: string | null) {
  return locationName
    ? formatLocationLabel(locationName, 2)
    : (LOCATIONS[locationCode] ?? "US");
}

function isEngine(value: string): value is SearchEngine {
  return (SEARCH_ENGINES as readonly string[]).includes(value);
}

/** keys.so-style project visibility: how many tracked keywords sit in
 *  top-1/5/10/50 across the project's trackers, plus pages in search, with an
 *  engine × market × device switcher. Rendered above the domain list. */
export function RankTrackingProjectOverview({
  projectId,
}: {
  projectId: string;
}) {
  const [engine, setEngine] = useState<SearchEngine | typeof ALL>(ALL);
  const [marketKey, setMarketKey] = useState<string>(ALL);
  // Null until the user picks — the default follows what the in-scope
  // trackers actually check, so a mobile-only tracker doesn't open onto an
  // all-zero desktop view.
  const [deviceOverride, setDeviceOverride] = useState<
    "desktop" | "mobile" | null
  >(null);
  // 90d, not "All": the default view of the list page shouldn't pay for a
  // 730-day cross-config aggregation on every visit.
  const [sinceDays, setSinceDays] = useState(90);

  const configsQuery = useQuery({
    queryKey: ["rankTrackingConfigSummaries", projectId],
    queryFn: () => getRankTrackingConfigSummaries({ data: { projectId } }),
  });
  const configs = configsQuery.data ?? [];

  const engines = [...new Set(configs.map((config) => config.searchEngine))];
  const engineValue = engine !== ALL && engines.includes(engine) ? engine : ALL;
  const scopedConfigs = configs.filter(
    (config) => engineValue === ALL || config.searchEngine === engineValue,
  );
  const device =
    deviceOverride ??
    (scopedConfigs.some((config) => config.devices !== "mobile")
      ? "desktop"
      : "mobile");
  const markets = [
    ...new Map(
      scopedConfigs.map((config) => [marketKeyOf(config), config]),
    ).values(),
  ];
  // Resolve the selection through the markets list — never parse the key, a
  // locationName may contain the delimiter.
  const market =
    markets.find((config) => marketKeyOf(config) === marketKey) ?? null;
  const marketItems = [
    { value: ALL, label: "All markets" },
    ...markets.map((config) => ({
      value: marketKeyOf(config),
      label: marketLabel(config.locationCode, config.locationName),
    })),
  ];

  // Disabled rather than skipped so the hook order is stable when the project
  // has no trackers yet.
  const summaryQuery = useQuery({
    queryKey: [
      "rankProjectSummary",
      projectId,
      engineValue,
      market ? marketKeyOf(market) : ALL,
      device,
    ],
    enabled: configs.length > 0,
    queryFn: () =>
      getRankProjectSummary({
        data: {
          projectId,
          device,
          ...(engineValue !== ALL ? { searchEngine: engineValue } : {}),
          ...(market
            ? {
                locationCode: market.locationCode,
                locationName: market.locationName,
              }
            : {}),
        },
      }),
  });

  const trendQuery = useQuery({
    queryKey: [
      "rankProjectTrend",
      projectId,
      engineValue,
      market ? marketKeyOf(market) : ALL,
      device,
      sinceDays,
    ],
    enabled: configs.length > 0,
    queryFn: () =>
      getRankProjectTrend({
        data: {
          projectId,
          device,
          sinceDays,
          ...(engineValue !== ALL ? { searchEngine: engineValue } : {}),
          ...(market
            ? {
                locationCode: market.locationCode,
                locationName: market.locationName,
              }
            : {}),
        },
      }),
  });

  const chartData = useMemo(
    () =>
      (trendQuery.data ?? []).map((point) => ({
        checkedAt: Date.parse(`${point.day}T00:00:00Z`),
        ...point,
      })),
    [trendQuery.data],
  );

  // No trackers yet — the card is noise next to the add-domain call to
  // action. A failed configs fetch also hides the card: the domain list
  // below shares the query and shows the error state.
  if (
    (configsQuery.isSuccess && configs.length === 0) ||
    configsQuery.isError
  ) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Keyword visibility</span>
        <div className="flex flex-wrap items-center gap-2">
          {engines.length > 1 ? (
            <Select
              value={engineValue}
              onValueChange={(value) => {
                if (value != null && (value === ALL || isEngine(value))) {
                  setEngine(value);
                }
              }}
            >
              <SelectTrigger size="sm" className="w-32" aria-label="Engine">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[{ value: ALL, label: "All engines" }]
                  .concat(
                    engines.map((value) => ({
                      value,
                      label: SEARCH_ENGINE_LABELS[value],
                    })),
                  )
                  .map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : null}
          {marketItems.length > 2 ? (
            <Select
              value={market ? marketKeyOf(market) : ALL}
              onValueChange={(value) => {
                if (value != null) setMarketKey(value);
              }}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Market">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {marketItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <SegmentedToggle
            items={[
              {
                value: "desktop" as const,
                icon: <Monitor className="size-3.5" />,
                label: "Desktop",
              },
              {
                value: "mobile" as const,
                icon: <Smartphone className="size-3.5" />,
                label: "Mobile",
              },
            ]}
            value={device}
            onChange={setDeviceOverride}
          />
          <TrendRangeToggle value={sinceDays} onChange={setSinceDays} />
        </div>
      </div>

      {/* Current state from each keyword's latest snapshot — independent of
          the chart's history, so the numbers render on the first check. */}
      <QueryState
        query={summaryQuery}
        errorFallback="Failed to load visibility summary"
        loading={<Skeleton className="h-[76px] w-full" />}
      >
        {(summary) => <VisibilityTiles point={summary} />}
      </QueryState>

      <QueryState
        query={trendQuery}
        errorFallback="Failed to load visibility history"
        loading={<Skeleton className="h-[220px] w-full" />}
      >
        {() =>
          chartData.length <= 1 ? (
            <TrendEmptyState checks={chartData.length} />
          ) : (
            <ChartContainer config={chartConfig} className="h-[220px]">
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <ChartGrid />
                <ChartXAxis {...TIME_AXIS} />
                <ChartYAxis allowDecimals={false} width={28} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent labelFormatter={formatDateLabel} />
                  }
                />
                {BUCKETS.map((b) => (
                  <Area
                    key={b.key}
                    type="monotone"
                    dataKey={b.key}
                    stackId="positions"
                    stroke={`var(--color-${b.key})`}
                    fill={`var(--color-${b.key})`}
                    fillOpacity={0.7}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          )
        }
      </QueryState>
    </div>
  );
}

/** Cumulative keys.so-style counters derived from the disjoint buckets of the
 *  current state. */
function VisibilityTiles({ point }: { point: RankProjectSummary }) {
  const tiles = [
    { label: "Top 1", value: point.top1 },
    { label: "Top 5", value: point.top1 + point.top2to5 },
    { label: "Top 10", value: point.top1 + point.top2to5 + point.top6to10 },
    {
      label: "Top 50",
      value: point.top1 + point.top2to5 + point.top6to10 + point.top11to50,
    },
    { label: "Keywords", value: point.total + point.notChecked },
    { label: "Pages in search", value: point.pages },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-border bg-card px-3 py-2"
        >
          <p className="text-xs text-muted-foreground">{tile.label}</p>
          <p className="text-lg font-semibold tabular-nums">
            {tile.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
