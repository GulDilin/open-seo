import { useMemo } from "react";
import { Area, AreaChart } from "recharts";
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
import type {
  RankProjectSummary,
  RankProjectTrendPoint,
} from "@/shared/rank-tracking";
import {
  formatDateLabel,
  TIME_AXIS,
  TrendEmptyState,
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

/** Stacked keyword-visibility chart: one row per day of the given trend, with
 *  the honest empty states until two checks exist. Shared by the tracker
 *  dashboard and the domain overview's per-engine blocks. */
export function RankVisibilityChart({
  points,
}: {
  points: RankProjectTrendPoint[];
}) {
  const chartData = useMemo(
    () =>
      points.map((point) => ({
        checkedAt: Date.parse(`${point.day}T00:00:00Z`),
        ...point,
      })),
    [points],
  );

  if (chartData.length <= 1)
    return <TrendEmptyState checks={chartData.length} />;

  return (
    <ChartContainer config={chartConfig} className="h-[220px]">
      <AreaChart
        data={chartData}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <ChartGrid />
        <ChartXAxis {...TIME_AXIS} />
        <ChartYAxis allowDecimals={false} width={28} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={formatDateLabel} />}
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
  );
}

/** Cumulative keys.so-style counters derived from the disjoint buckets of the
 *  current state. */
export function RankVisibilityTiles({ point }: { point: RankProjectSummary }) {
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
