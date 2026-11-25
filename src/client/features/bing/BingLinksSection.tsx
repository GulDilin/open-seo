import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
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
import { BingConnectionCard } from "@/client/features/bing/BingConnectionCard";
import { getBingLinks } from "@/serverFunctions/bingWebmaster";

type BingLinksData = Awaited<ReturnType<typeof getBingLinks>>;

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** The Bing links page: per-page inbound-link counts Bing reports, plus the
 *  sample source pages collected into shared webmaster link storage. */
export function BingLinksSection({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["bingLinks", projectId],
    queryFn: () => getBingLinks({ data: { projectId } }),
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
            fallback="Failed to load Bing Webmaster link data"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>External links</CardTitle>
        <CardDescription>
          {data.connected && data.siteUrl
            ? `Bing Webmaster reports for ${data.siteUrl}.`
            : "Free first-party link data from Bing Webmaster."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BingLinksPanel projectId={projectId} data={data} />
      </CardContent>
    </Card>
  );
}

function BingLinksPanel({
  projectId,
  data,
}: {
  projectId: string;
  data: BingLinksData;
}) {
  if (!data.connected) {
    return (
      <div className="max-w-2xl space-y-3">
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
    <div className="space-y-4">
      {data.collectError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh from Bing Webmaster: {data.collectError} The data
          below may be stale.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-xs text-muted-foreground">Links to loaded pages</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">
            {formatCount(data.loadedLinksTotal)}
          </p>
        </div>
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

      {data.linkCounts.length > 0 ? (
        <>
          <Table aria-label="Pages with inbound links">
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.linkCounts.map((link) => (
                <TableRow key={link.url}>
                  <TableCell className="max-w-96 truncate font-medium">
                    {link.url}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {link.count.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            {data.linkCountsTruncated
              ? `Loaded ${data.linkCounts.length} of Bing's ${data.totalPages} pages of linked URLs — the rest are available in Bing Webmaster. `
              : ""}
            Bing reports no site-wide link total, so this sum covers the loaded
            pages only; counts are read live from Bing on every visit.
          </p>
        </>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Bing has not reported inbound links for this site yet.
        </p>
      )}

      {data.samples.length > 0 ? (
        <>
          <Table aria-label="Sample external links">
            <TableHeader>
              <TableRow>
                <TableHead>Source page</TableHead>
                <TableHead>Links to</TableHead>
                <TableHead>Anchor text</TableHead>
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
                  <TableCell className="max-w-56 truncate">
                    {sample.anchorText ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Sampled from Bing's top pages twice a day and stored; anchor text is
            only kept for the most recent collect. Bing reports no discovery
            dates for links.
          </p>
        </>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Bing has not reported sample external links for this site yet.
        </p>
      )}
    </div>
  );
}
