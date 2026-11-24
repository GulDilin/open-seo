import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { getIndexStatus } from "@/serverFunctions/indexStatus";

const SOURCE_LABELS: Record<string, string> = {
  gsc_search: "GSC search",
  yandex_samples: "Yandex samples",
  audit_crawl: "Site audit",
};

const GOOGLE_NO_DATA = "Not inspected yet — URL Inspection is quota-limited";
const YANDEX_NO_DATA = "Not in the Yandex samples collected";

type IndexStatusRow = Awaited<
  ReturnType<typeof getIndexStatus>
>["rows"][number];
type EngineCheck = NonNullable<IndexStatusRow["google"]>;

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

/** Absolute timestamp for a check or a collect; the raw value when unparsable.
 *  Also used by the page's connection summary. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** "Discovered via" badges for one page: stacked in the desktop table, wrapped
 *  in the mobile block. */
function SourceBadges({
  sources,
  className,
}: {
  sources: IndexStatusRow["sources"];
  className: string;
}) {
  return (
    <div className={className}>
      {sources.map((source) => (
        <Badge key={source} variant="outline" className="text-xs">
          {SOURCE_LABELS[source] ?? source}
        </Badge>
      ))}
    </div>
  );
}

/** The collected pages in both layouts: stacked blocks below `sm`, where the
 *  four-column table would need horizontal scrolling, and the table from `sm`
 *  up. Both render the same verdict cells, so they can never drift. */
export function IndexStatusRows({ rows }: { rows: IndexStatusRow[] }) {
  return (
    <>
      <ul className="divide-y divide-border px-4 sm:hidden">
        {rows.map((row) => (
          <li key={row.url} className="flex flex-col gap-2 py-3">
            {/* flex keeps the link's icon beside the wrapping URL instead of
                dropping it onto its own line. */}
            <SafeExternalLink
              url={row.url}
              label={row.url}
              className="flex items-start gap-1 break-all font-medium hover:underline"
            />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Google
              </p>
              <EngineStatusCell
                check={row.google}
                noDataExplanation={GOOGLE_NO_DATA}
              />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Yandex
              </p>
              <EngineStatusCell
                check={row.yandex}
                noDataExplanation={YANDEX_NO_DATA}
              />
            </div>
            {row.sources.length > 0 ? (
              <SourceBadges
                sources={row.sources}
                className="flex flex-wrap gap-1"
              />
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
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
            {rows.map((row) => (
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
                    noDataExplanation={GOOGLE_NO_DATA}
                  />
                </TableCell>
                <TableCell className="align-top">
                  <EngineStatusCell
                    check={row.yandex}
                    noDataExplanation={YANDEX_NO_DATA}
                  />
                </TableCell>
                <TableCell className="align-top">
                  <SourceBadges
                    sources={row.sources}
                    className="flex max-w-48 flex-col items-start gap-1"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
