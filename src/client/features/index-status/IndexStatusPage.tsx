import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Spinner } from "@/client/components/ui/spinner";
import { Switch } from "@/client/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { YandexConnectionCard } from "@/client/features/integrations/YandexConnectionCard";
import { getIndexStatus } from "@/serverFunctions/indexStatus";
import {
  DEFAULT_INDEX_STATUS_PAGE_SIZE,
  INDEX_STATUS_PAGE_SIZES,
} from "@/types/schemas/index-status";

type Search = {
  problemsOnly?: boolean;
  page?: number;
  size?: number;
};

type IndexStatusData = Awaited<ReturnType<typeof getIndexStatus>>;
type EngineCheck = NonNullable<IndexStatusData["rows"][number]["google"]>;

const SOURCE_LABELS: Record<string, string> = {
  gsc_search: "GSC search",
  yandex_samples: "Yandex samples",
  audit_crawl: "Site audit",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** One engine cell: verdict chip + reason for absence + when it was verified.
 *  No stored check renders as an explicit unknown, never as "not indexed". */
function EngineStatusCell({
  check,
  noDataExplanation,
}: {
  check: EngineCheck | null;
  noDataExplanation: string;
}) {
  if (!check) {
    return (
      <div className="space-y-0.5">
        <p className="text-sm text-muted-foreground">No data</p>
        <p className="text-xs text-muted-foreground">{noDataExplanation}</p>
      </div>
    );
  }
  const label =
    check.status === "indexed"
      ? "In index"
      : check.status === "likely_indexed"
        ? "Likely in index"
        : "Not indexed";
  const reason =
    check.status === "not_indexed"
      ? (check.reason ?? "Reason unknown")
      : check.status === "likely_indexed"
        ? "Received impressions in Search Console"
        : check.reason;
  return (
    <div className="space-y-0.5">
      <p
        className={`text-sm font-medium ${
          check.status === "not_indexed"
            ? "text-red-600 dark:text-red-400"
            : check.status === "likely_indexed"
              ? "text-amber-600 dark:text-amber-400"
              : "text-green-700 dark:text-green-400"
        }`}
      >
        {label}
      </p>
      {reason ? (
        <p className="text-xs text-muted-foreground" title={reason}>
          {reason}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Checked {formatDateTime(check.checkedAt)}
      </p>
    </div>
  );
}

/** Connection strip for one engine: refresh state and quota notes. */
function EngineSummary({
  title,
  detail,
  connected,
  unavailableReason,
  collectError,
  lastCollectedAt,
}: {
  title: string;
  detail: string | null;
  connected: boolean;
  unavailableReason: string | null;
  collectError: string | null;
  lastCollectedAt: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{title}</p>
        <Badge variant={connected ? "secondary" : "outline"}>
          {connected ? "Connected" : "Not connected"}
        </Badge>
      </div>
      {detail ? (
        <p className="mt-0.5 truncate text-sm font-medium" title={detail}>
          {detail}
        </p>
      ) : null}
      {unavailableReason ? (
        <p role="alert" className="mt-0.5 text-xs text-destructive">
          Unavailable: {unavailableReason}
        </p>
      ) : null}
      {collectError ? (
        <p role="alert" className="mt-0.5 text-xs text-destructive">
          Refresh issue: {collectError}
        </p>
      ) : null}
      <p className="mt-0.5 text-xs text-muted-foreground">
        Last refreshed {formatDateTime(lastCollectedAt)}
      </p>
    </div>
  );
}

/** Index Status: every known page of the project with its Google and Yandex
 *  indexation verdict, the reason when a page is absent, and a filter for
 *  pages missing from at least one index. GSC inspections are quota-capped and
 *  cached, so un-inspected pages show honest unknowns instead of verdicts. */
export function IndexStatusPage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: Search;
  onSearchChange: (update: Partial<Search>) => void;
}) {
  const queryClient = useQueryClient();
  const problemsOnly = search.problemsOnly ?? false;
  const page = search.page ?? 1;
  const size = search.size ?? DEFAULT_INDEX_STATUS_PAGE_SIZE;

  const query = useQuery({
    queryKey: ["indexStatus", projectId, problemsOnly, page, size],
    queryFn: () =>
      getIndexStatus({
        data: { projectId, problemsOnly, page, size },
      }),
  });
  const refresh = useMutation({
    mutationFn: () =>
      getIndexStatus({
        data: { projectId, problemsOnly, page, size, force: true },
      }),
    onSuccess: () => {
      toast.success("Index status refreshed");
      void queryClient.invalidateQueries({
        queryKey: ["indexStatus", projectId],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Refresh failed");
    },
  });
  const data = query.data;

  // Reads are served from storage, so a stale payload kicks exactly one
  // background refresh per mount. After it lands the payload reports
  // stale: false (or the ref guard stops a dead grant from re-triggering).
  const autoCollectStarted = useRef(false);
  useEffect(() => {
    if (!data?.stale || autoCollectStarted.current) return;
    autoCollectStarted.current = true;
    refresh.mutate();
    // `refresh` changes every render; the ref above keeps this to one fire.
  }, [data?.stale, refresh]);

  if (query.isPending) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <Skeleton className="h-5 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
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
            fallback="Failed to load index status"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        </CardContent>
      </Card>
    );
  }

  const neitherConnected = !data.google.connected && !data.yandex.connected;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Index Status</CardTitle>
          <CardDescription>
            Every page known to your connected search engines, with why a page
            is missing from an index. Google verdicts come from quota-limited
            URL inspections (cached per page) and impressions; Yandex verdicts
            come from its in-search and excluded-page samples.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EngineSummary
              title="Google (Search Console)"
              detail={data.google.siteUrl}
              connected={data.google.connected}
              unavailableReason={data.google.unavailableReason}
              collectError={data.google.collectError}
              lastCollectedAt={data.google.lastCollectedAt}
            />
            <EngineSummary
              title="Yandex (Webmaster)"
              detail={data.yandex.hostUrl}
              connected={data.yandex.connected}
              unavailableReason={data.yandex.unavailableReason}
              collectError={data.yandex.collectError}
              lastCollectedAt={data.yandex.lastCollectedAt}
            />
          </div>

          {neitherConnected ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <GoogleConnectionCard provider="gsc" projectId={projectId} />
              <YandexConnectionCard projectId={projectId} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {data.totals.pages.toLocaleString()} pages known ·{" "}
                <span className="font-medium text-red-600 dark:text-red-400">
                  {data.totals.problems.toLocaleString()} with problems
                </span>{" "}
                · {data.totals.inspected.toLocaleString()} verified by URL
                inspection (up to 50 inspected per refresh)
              </p>
              <div className="flex items-center gap-4">
                {data.stale ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Spinner className="size-3" />
                    Collecting fresh data…
                  </span>
                ) : null}
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Switch
                    checked={problemsOnly}
                    onCheckedChange={(checked) =>
                      onSearchChange({ problemsOnly: checked, page: 1 })
                    }
                  />
                  Only pages with problems
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refresh.isPending}
                  onClick={() => refresh.mutate()}
                >
                  <RefreshCw
                    data-icon="inline-start"
                    className={refresh.isPending ? "animate-spin" : undefined}
                  />
                  Refresh
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {neitherConnected ? (
        <Card>
          <CardContent>
            <p className="py-4 text-center text-sm text-muted-foreground">
              Connect Search Console and Yandex Webmaster to see which of your
              pages are in each index.
            </p>
          </CardContent>
        </Card>
      ) : data.rows.length === 0 ? (
        <Card>
          <CardContent>
            <p className="py-4 text-center text-sm text-muted-foreground">
              {problemsOnly
                ? "No pages with indexation problems — every known page is in both indexes (or has no data yet)."
                : data.google.unavailableReason && data.yandex.unavailableReason
                  ? "Neither engine could be reached yet. Use Refresh once the connections are restored."
                  : data.stale
                    ? "Collecting pages from your connected engines…"
                    : "No pages collected yet — use Refresh to pull pages from the connected engines."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>Google</TableHead>
                  <TableHead>Yandex</TableHead>
                  <TableHead>Discovered via</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.url}>
                    <TableCell className="max-w-96">
                      <SafeExternalLink
                        url={row.url}
                        label={row.url}
                        className="block truncate font-medium hover:underline"
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <EngineStatusCell
                        check={row.google}
                        noDataExplanation="Not inspected yet — URL Inspection is quota-limited"
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <EngineStatusCell
                        check={row.yandex}
                        noDataExplanation="Not in the Yandex samples collected"
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex max-w-48 flex-col items-start gap-1">
                        {row.sources.map((source) => (
                          <Badge
                            key={source}
                            variant="outline"
                            className="text-xs"
                          >
                            {SOURCE_LABELS[source] ?? source}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              pageSize={size}
              pageSizes={INDEX_STATUS_PAGE_SIZES}
              totalCount={data.totalMatching}
              isLoading={query.isFetching}
              onPageChange={(nextPage) => onSearchChange({ page: nextPage })}
              onPageSizeChange={(nextSize) =>
                onSearchChange({ size: nextSize, page: 1 })
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
