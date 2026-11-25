import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { BingConnectionCard } from "@/client/features/bing/BingConnectionCard";
import {
  percentDelta,
  positionDelta,
  TotalsTable,
} from "@/client/features/search-performance/SearchPerformanceParts";
import { getBingSearchPerformance } from "@/serverFunctions/bingWebmaster";
import {
  BING_DATE_RANGES,
  BING_QUERY_ORDERS,
  type BingDateRange,
  type BingQueryOrder,
} from "@/server/features/bing/bingSearchQueries";

const RANGE_LABELS: Record<BingDateRange, string> = {
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_3_months: "Last 3 months",
};

const ORDER_LABELS: Record<BingQueryOrder, string> = {
  clicks: "Top by clicks",
  impressions: "Top by impressions",
};

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

function formatPosition(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatCtr(clicks: number | null, impressions: number | null): string {
  if (clicks === null || impressions === null || impressions === 0) return "—";
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

type BingPerformanceData = Exclude<
  Awaited<ReturnType<typeof getBingSearchPerformance>>,
  { connected: false }
>;

/** The Bing section's performance page: per-query impressions and clicks,
 *  rolled up from the weekly buckets Bing reports. Everything shown is what
 *  Bing reported — including nulls where it has no value. */
export function BingSection({ projectId }: { projectId: string }) {
  const [range, setRange] = useState<BingDateRange>("last_28_days");
  const [orderBy, setOrderBy] = useState<BingQueryOrder>("clicks");

  const query = useQuery({
    queryKey: ["bingSearchPerformance", projectId, range, orderBy],
    queryFn: () =>
      getBingSearchPerformance({
        data: { projectId, dateRange: range, orderBy },
      }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading Bing Webmaster data"
        className="space-y-3 p-4"
      >
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-4">
        <QueryError
          error={query.error}
          fallback="Failed to load Bing Webmaster data"
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      </div>
    );
  }
  if (!data.connected) {
    return (
      <div className="max-w-2xl space-y-3 p-4">
        {data.unavailableReason ? (
          <p role="alert" className="text-sm text-destructive">
            Bing Webmaster data is unavailable: {data.unavailableReason}{" "}
            Reconnect Bing Webmaster to restore it.
          </p>
        ) : null}
        <BingConnectionCard projectId={projectId} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectSize
          value={range}
          onChange={setRange}
          options={BING_DATE_RANGES.map((value) => ({
            value,
            label: RANGE_LABELS[value],
          }))}
        />
        <SelectSize
          value={orderBy}
          onChange={setOrderBy}
          options={BING_QUERY_ORDERS.map((value) => ({
            value,
            label: ORDER_LABELS[value],
          }))}
        />
        {query.isFetching && !query.isPlaceholderData ? (
          <span className="text-xs text-muted-foreground">Updating…</span>
        ) : null}
      </div>

      {data.rows.length > 0 ? (
        <div className="space-y-1.5">
          <TotalsTable
            metrics={metricCards(data)}
            deltaTitle={changeTitle(data)}
          />
          <p className="text-xs text-muted-foreground">
            Card totals aggregate the {data.rows.length} loaded queries — they
            cover Bing's top queries, not the whole site.{" "}
            {data.change
              ? `Change compares the same queries with ${data.change.dateFrom} to ${data.change.dateTo} (${data.change.matchedQueryCount} of ${data.rows.length} matched).`
              : null}
          </p>
        </div>
      ) : null}

      {query.isError ? (
        <QueryError
          error={query.error}
          fallback="Failed to load Bing Webmaster data"
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      ) : data.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Bing has no query data for this site in the selected period.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Query</TableHead>
              <TableHead className="text-right">Impressions</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">Avg impression pos</TableHead>
              <TableHead className="text-right">Avg click pos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.query}>
                <TableCell className="max-w-72 truncate font-medium">
                  {row.query}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.impressions)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.clicks)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCtr(row.clicks, row.impressions)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPosition(row.avgImpressionPosition)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPosition(row.avgClickPosition)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Bing updates query data weekly; the loaded rows cover weekly buckets
        {data.reportedDateFrom
          ? ` from ${data.reportedDateFrom} through ${data.reportedDateTo}`
          : ""}
        , so a bucket at the window edge may include days outside it. CTR and
        average positions are derived from Bing's per-bucket averages.
      </p>
    </div>
  );
}

/** Bing-parity metric rows from the query aggregates. Average position is the
 *  impression-weighted average of Bing's per-bucket impression position. */
function metricCards(data: BingPerformanceData) {
  const prev = data.change?.totals ?? null;
  return [
    {
      label: "Clicks",
      value: formatCount(data.totals.clicks),
      delta: percentDelta(data.totals.clicks, prev?.clicks ?? null),
    },
    {
      label: "Impressions",
      value: formatCount(data.totals.impressions),
      delta: percentDelta(data.totals.impressions, prev?.impressions ?? null),
    },
    {
      label: "Click-through rate",
      value: formatRate(data.totals.ctr),
      delta: percentDelta(data.totals.ctr, prev?.ctr ?? null),
    },
    {
      label: "Average position",
      value: formatPosition(data.totals.position),
      delta: positionDelta(data.totals.position, prev?.position ?? null),
    },
  ];
}

function changeTitle(data: BingPerformanceData): string {
  return data.change
    ? `Compared with ${data.change.dateFrom} to ${data.change.dateTo}`
    : "No previous-period comparison available";
}

function SelectSize<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
