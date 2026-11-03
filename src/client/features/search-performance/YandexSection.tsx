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
import { YandexConnectionCard } from "@/client/features/integrations/YandexConnectionCard";
import { getYandexSearchPerformance } from "@/serverFunctions/yandexWebmaster";
import {
  YANDEX_DATE_RANGES,
  YANDEX_DEVICE_TYPES,
  YANDEX_QUERY_ORDERS,
  type YandexDateRange,
  type YandexDeviceTypeOption,
  type YandexQueryOrder,
} from "@/server/features/yandex/yandexSearchQueries";

const RANGE_LABELS: Record<YandexDateRange, string> = {
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_3_months: "Last 3 months",
};

const DEVICE_LABELS: Record<YandexDeviceTypeOption, string> = {
  all: "All devices",
  desktop: "Desktop",
  mobile_and_tablet: "Mobile + tablet",
};

const ORDER_LABELS: Record<YandexQueryOrder, string> = {
  clicks: "Top by clicks",
  impressions: "Top by impressions",
};

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

function formatPosition(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

function formatCtr(clicks: number | null, impressions: number | null): string {
  if (clicks === null || impressions === null || impressions === 0) return "—";
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

/** The Yandex tab of Search Performance: site summary plus popular queries.
 *  Everything shown is what Yandex reported — including the (possibly
 *  shorter) window and nulls for indicators Yandex does not compute. */
export function YandexSection({ projectId }: { projectId: string }) {
  const [range, setRange] = useState<YandexDateRange>("last_28_days");
  const [device, setDevice] = useState<YandexDeviceTypeOption>("all");
  const [orderBy, setOrderBy] = useState<YandexQueryOrder>("clicks");

  const query = useQuery({
    queryKey: ["yandexSearchPerformance", projectId, range, device, orderBy],
    queryFn: () =>
      getYandexSearchPerformance({
        data: { projectId, dateRange: range, deviceType: device, orderBy },
      }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading Yandex Webmaster data"
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
          fallback="Failed to load Yandex Webmaster data"
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      </div>
    );
  }
  if (!data.connected) {
    return (
      <div className="max-w-2xl p-4">
        <YandexConnectionCard projectId={projectId} />
      </div>
    );
  }

  const summary = data.summary;
  return (
    <div className="space-y-4 p-4">
      {summary ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryStat label="Yandex SQI" value={formatCount(summary.sqi)} />
          <SummaryStat
            label="Pages in search"
            value={formatCount(summary.searchablePagesCount)}
          />
          <SummaryStat
            label="Excluded pages"
            value={formatCount(summary.excludedPagesCount)}
          />
          <SummaryStat
            label="Indexing status"
            value={data.indexingStatus ?? "—"}
          />
          <SummaryStat
            label="Problems (fatal / critical)"
            value={`${formatCount(summary.problems.fatal)} / ${formatCount(summary.problems.critical)}`}
          />
          <SummaryStat
            label="Possible / recommendations"
            value={`${formatCount(summary.problems.possibleProblem)} / ${formatCount(summary.problems.recommendation)}`}
          />
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SelectSize
          value={range}
          onChange={setRange}
          options={YANDEX_DATE_RANGES.map((value) => ({
            value,
            label: RANGE_LABELS[value],
          }))}
        />
        <SelectSize
          value={device}
          onChange={setDevice}
          options={YANDEX_DEVICE_TYPES.map((value) => ({
            value,
            label: DEVICE_LABELS[value],
          }))}
        />
        <SelectSize
          value={orderBy}
          onChange={setOrderBy}
          options={YANDEX_QUERY_ORDERS.map((value) => ({
            value,
            label: ORDER_LABELS[value],
          }))}
        />
        {query.isFetching && !query.isPlaceholderData ? (
          <span className="text-xs text-muted-foreground">Updating…</span>
        ) : null}
      </div>

      {query.isError ? (
        <QueryError
          error={query.error}
          fallback="Failed to load Yandex Webmaster data"
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      ) : data.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Yandex has no query data for this site in the selected period.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Query</TableHead>
              <TableHead className="text-right">Impressions</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">Avg show pos</TableHead>
              <TableHead className="text-right">Avg click pos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.queryId}>
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
                  {formatPosition(row.avgShowPosition)}
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
        Yandex reported {data.reportedDateFrom} → {data.reportedDateTo} (the
        window may be shorter than requested — Yandex finalizes data ~4 days
        late). Top {data.rows.length} of {data.totalCount.toLocaleString()}{" "}
        available queries; CTR is derived, positions are Yandex averages.
      </p>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold">{value}</dd>
    </div>
  );
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
