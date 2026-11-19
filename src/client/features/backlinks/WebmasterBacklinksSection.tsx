import { useQuery } from "@tanstack/react-query";
import { Line, LineChart } from "recharts";
import { QueryError } from "@/client/components/QueryState";
import { ChartGrid, ChartXAxis, ChartYAxis } from "@/client/components/ChartAxes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { YandexConnectionCard } from "@/client/features/integrations/YandexConnectionCard";
import { getWebmasterBacklinks } from "@/serverFunctions/backlinks";

type WebmasterBacklinksData = Awaited<ReturnType<typeof getWebmasterBacklinks>>;

const historyChartConfig = {
  links: { label: "External links", color: "#2563eb" },
} satisfies ChartConfig;

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  return value ?? "—";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Summary tile: latest link count, change vs the previous stored point. */
function LatestCountStat({
  latest,
  previous,
}: {
  latest: { date: string; linksTotalCount: number } | null;
  previous: { date: string; linksTotalCount: number } | null;
}) {
  let delta: number | null = null;
  if (latest && previous) delta = latest.linksTotalCount - previous.linksTotalCount;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">
        External links (as of {formatDate(latest?.date)})
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">
        {formatCount(latest?.linksTotalCount)}
        {delta !== null && delta !== 0 ? (
          <span
            className={`ml-2 text-xs font-medium ${delta > 0 ? "text-green-600" : "text-red-600"}`}
          >
            {delta > 0 ? "+" : ""}
            {delta.toLocaleString()}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function YandexPanel({
  projectId,
  data,
}: {
  projectId: string;
  data: WebmasterBacklinksData["yandex"];
}) {
  if (!data.connected) {
    return (
      <div className="max-w-2xl space-y-3">
        {data.unavailableReason ? (
          <p role="alert" className="text-sm text-destructive">
            Yandex Webmaster data is unavailable: {data.unavailableReason}{" "}
            Reconnect Yandex Webmaster to restore it.
          </p>
        ) : null}
        <YandexConnectionCard projectId={projectId} />
      </div>
    );
  }

  const latest = data.latest;
  const previous =
    data.history.length >= 2 ? data.history[data.history.length - 2] : null;

  return (
    <div className="space-y-4">
      {data.collectError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh from Yandex Webmaster: {data.collectError} The data
          below may be stale.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LatestCountStat latest={latest} previous={previous} />
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-xs text-muted-foreground">Sample links stored</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {formatCount(data.storedSamplesCount)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-xs text-muted-foreground">Last refreshed</p>
          <p className="mt-0.5 truncate text-sm font-semibold">
            {formatDateTime(data.lastCollectedAt)}
          </p>
        </div>
      </div>

      {data.history.length > 1 ? (
        <ChartContainer
          config={historyChartConfig}
          className="h-48"
          aria-label="External links history"
        >
          <LineChart data={data.history} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
            <ChartGrid />
            <ChartXAxis dataKey="date" minTickGap={32} />
            <ChartYAxis tickFormatter={(value) => Number(value).toLocaleString()} width={56} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="linksTotalCount"
              name="External links"
              stroke="var(--color-links)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {data.history.length === 1
            ? "Yandex has reported a single data point so far — the trend appears after the next refresh."
            : "Yandex has not reported external links data for this site yet."}
        </p>
      )}

      {data.samples.length > 0 ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source page</TableHead>
                <TableHead>Links to</TableHead>
                <TableHead className="text-right">Discovered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.samples.map((sample) => (
                <TableRow
                  key={`${sample.sourceUrl} → ${sample.destinationUrl}`}
                >
                  <TableCell className="max-w-80 truncate font-medium">
                    {sample.sourceUrl}
                  </TableCell>
                  <TableCell className="max-w-80 truncate">
                    {sample.destinationUrl}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDate(sample.discoveryDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            {data.samplesTruncated
              ? `Showing the newest ${data.samples.length} of ${data.storedSamplesCount.toLocaleString()} stored samples (capped) — the full pool is available in Yandex Webmaster.`
              : `Showing ${data.samples.length} of ${data.storedSamplesCount.toLocaleString()} stored samples.`}
          </p>
        </>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Yandex has not reported sample external links for this site yet.
        </p>
      )}
    </div>
  );
}

function GscPanel({ data }: { data: { connected: boolean; siteUrl: string | null } }) {
  return (
    <div className="max-w-2xl space-y-2 text-sm text-muted-foreground">
      {data.connected ? (
        <p>
          Search Console property{" "}
          <span className="font-medium text-foreground">{data.siteUrl}</span> is
          connected.
        </p>
      ) : (
        <p>Search Console is not connected to this project.</p>
      )}
      <p>
        Google does not expose backlink data through the Search Console API —
        the Links report (external links, top linking sites, anchor text) is
        only available in the Search Console interface and via its manual
        export. This section therefore shows no link counts for Google; connect
        Yandex Webmaster for API-backed link tracking.
      </p>
    </div>
  );
}

/** Webmaster-sourced external links: collected snapshots and samples from the
 *  project's connected webmaster tools, rendered above the DataForSEO-powered
 *  research below. Free first-party data — shown even without DataForSEO. */
export function WebmasterBacklinksSection({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["webmasterBacklinks", projectId],
    queryFn: () => getWebmasterBacklinks({ data: { projectId } }),
  });
  const data = query.data;

  if (query.isPending) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent>
          <QueryError
            error={query.error}
            fallback="Failed to load webmaster link data"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        </CardContent>
      </Card>
    );
  }
  if (!data.yandex.connected && !data.gsc.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Links from webmaster tools</CardTitle>
          <CardDescription>
            Free first-party link data from Yandex Webmaster. Google Search
            Console does not provide link data through its API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <YandexConnectionCard projectId={projectId} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Links from webmaster tools</CardTitle>
        <CardDescription>
          {data.yandex.connected && data.yandex.hostUrl
            ? `Yandex Webmaster reports for ${data.yandex.hostUrl}. Google Search Console does not provide link data through its API.`
            : "Google Search Console does not provide link data through its API."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="yandex">
          <TabsList>
            <TabsTrigger value="yandex">Yandex Webmaster</TabsTrigger>
            <TabsTrigger value="gsc">Google Search Console</TabsTrigger>
          </TabsList>
          <TabsContent value="yandex" className="pt-4">
            <YandexPanel projectId={projectId} data={data.yandex} />
          </TabsContent>
          <TabsContent value="gsc" className="pt-4">
            <GscPanel data={data.gsc} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
