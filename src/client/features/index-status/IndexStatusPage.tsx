import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
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
import { formatDateTime, IndexStatusRows } from "./IndexStatusRows";
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
  // A `silent` refresh is the background collect of a stale payload: the user
  // never asked for it, so it does not toast. The forced result is written
  // straight into the cache it was requested for — a dead grant never marks
  // itself collected, so a plain re-read would report stale again and hang the
  // collect indicator. Only sibling keys fall back to a normal re-read.
  const refresh = useMutation({
    mutationFn: (_options: { silent?: boolean } | undefined) =>
      getIndexStatus({
        data: { projectId, problemsOnly, page, size, force: true },
      }),
    onSuccess: (payload, options) => {
      if (!options?.silent) toast.success("Index status refreshed");
      queryClient.setQueryData(
        ["indexStatus", projectId, problemsOnly, page, size],
        payload,
      );
      void queryClient.invalidateQueries({
        queryKey: ["indexStatus", projectId],
        predicate: (candidate) =>
          candidate.queryKey[2] !== problemsOnly ||
          candidate.queryKey[3] !== page ||
          candidate.queryKey[4] !== size,
      });
    },
    onError: (error, options) => {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : "Refresh failed");
      }
    },
  });
  const data = query.data;

  // Reads are served from storage, so a stale payload kicks exactly one
  // background refresh per mount.
  const autoCollectStarted = useRef(false);
  useEffect(() => {
    if (!data?.stale || autoCollectStarted.current) return;
    autoCollectStarted.current = true;
    refresh.mutate({ silent: true });
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
              {/* The indicator follows the running collect, not `stale`: a dead
                  grant reads as stale forever, so a stale-gated spinner would
                  never clear. */}
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                {data.stale && refresh.isPending ? (
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
                  : data.stale && refresh.isPending
                    ? "Collecting pages from your connected engines…"
                    : "No pages collected yet — use Refresh to pull pages from the connected engines."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <IndexStatusRows rows={data.rows} />
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
