import { useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { safeHttpUrl } from "@/shared/safe-url";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Badge } from "@/client/components/ui/badge";
import { DataForSeoRequiredBadge } from "@/client/components/ProviderRequiredBadge";
import { getDashboardWebmasterLinks } from "@/serverFunctions/dashboard";
export function Freshness({
  stale,
  refreshError,
}: {
  fetchedAt: string;
  stale: boolean;
  refreshError: string | null;
}) {
  if (!stale && !refreshError) return null;
  return (
    <p role="status" className="text-xs text-muted-foreground">
      Showing saved results
      {refreshError
        ? ` · ${getStandardErrorMessage(new Error(refreshError), "Could not update. Showing saved results.")}`
        : ""}
      {refreshError === "INSUFFICIENT_CREDITS" ? (
        <Link to="/billing" className="ml-2 text-primary underline">
          Add credits
        </Link>
      ) : null}
    </p>
  );
}

export function ExternalPage({
  url,
  label,
}: {
  url: string | null;
  label?: string | null;
}) {
  const href = safeHttpUrl(url);
  return href ? (
    <a
      className="block max-w-80 truncate text-primary hover:underline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={url ?? undefined}
    >
      {label || url}
    </a>
  ) : (
    <span>{label || "—"}</span>
  );
}

export function DashboardInfo({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Info className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className="z-50">
          <Popover.Popup className="max-w-xs rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

type WebmasterLinksData = Awaited<
  ReturnType<typeof getDashboardWebmasterLinks>
>;
export type WebmasterLinkRow = WebmasterLinksData["yandex"][number];

// One query for both degraded link widgets, so the cache dedupes them.
export function useWebmasterLinksQuery(projectId: string) {
  return useQuery({
    queryKey: ["dashboardWebmasterLinks", projectId],
    queryFn: () => getDashboardWebmasterLinks({ data: { projectId } }),
    staleTime: 86400_000,
    retry: false,
  });
}

/** Yandex's own link table: source page, target page and the day Yandex found
 *  the link. Shared by the degraded widgets — without DataForSEO these rows
 *  are the whole widget. */
export function YandexLinksTable({ rows }: { rows: WebmasterLinkRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Referring page</TableHead>
          <TableHead>Target page</TableHead>
          <TableHead className="text-right">Found</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.urlFrom}:${row.urlTo}`}>
            <TableCell>
              <ExternalPage url={row.urlFrom} label={row.domainFrom} />
            </TableCell>
            <TableCell>
              <ExternalPage url={row.urlTo} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.firstSeen?.slice(0, 10) ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Labels a degraded widget's rows as Yandex's and reports a failed refresh
 *  instead of pretending the data is current. */
export function YandexSourceNote({
  collectError,
}: {
  collectError: string | null;
}) {
  return (
    <>
      <Badge variant="outline">Yandex Webmaster</Badge>
      <p className="text-sm text-muted-foreground">
        Links to your website that Yandex Webmaster found in the past 30 days. A
        link may be older than the date it was found.
      </p>
      {collectError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh from Yandex Webmaster: {collectError} The list may
          be stale.
        </p>
      ) : null}
    </>
  );
}

/** What a link widget shows when neither source can provide data: the dead
 *  grant's reconnect reason when Yandex was connected, plus the DataForSEO
 *  badge — which only applies once Yandex is unavailable too. */
export function WebmasterLinksUnavailable({
  unavailableReason,
}: {
  unavailableReason: string | null;
}) {
  return (
    <div className="space-y-3">
      {unavailableReason ? (
        <p role="alert" className="text-sm text-destructive">
          Yandex Webmaster data is unavailable: {unavailableReason} Reconnect
          Yandex Webmaster in Settings → Integrations to restore it.
        </p>
      ) : null}
      <DataForSeoRequiredBadge />
    </div>
  );
}
