import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import type { ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { DashboardDataTable } from "./DashboardDataTable";
import { useState, type ComponentProps } from "react";
import { sort } from "remeda";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { Badge } from "@/client/components/ui/badge";
import { getDashboardBacklinks } from "@/serverFunctions/dashboard";
import {
  DataForSeoRequiredBadge,
  useSeoProviderSetup,
} from "@/client/components/ProviderRequiredBadge";
import { Freshness, ExternalPage } from "./siteTabParts";
const KINDS = ["new", "lost", "all"] as const;
type Kind = (typeof KINDS)[number];

const DESCRIPTIONS: Record<Kind, string> = {
  new: "Links to your website found in the past week. A link may be older than the date it was found.",
  lost: "Links that were found before but are no longer there. Last checked is when we last checked the link, not when it disappeared.",
  all: "Recently found links that still point to your website.",
};

export function DashboardBacklinks({
  projectId,
  domain,
}: {
  projectId: string;
  domain: string;
}) {
  const [kind, setKind] = useState<Kind>("new");
  const setup = useSeoProviderSetup();
  const query = useQuery({
    queryKey: ["dashboardBacklinks", projectId, domain, kind],
    queryFn: () => getDashboardBacklinks({ data: { projectId, kind } }),
    staleTime: 86400_000,
    retry: false,
    // Same DataForSEO gate as the link-activity card: no key, no request —
    // the badge explains instead of a load error.
    enabled: setup.data?.dataforseo === true,
  });
  if (setup.data && !setup.data.dataforseo) return <DataForSeoRequiredBadge />;
  return (
    <DashboardBacklinkTable
      rows={withYandexNewLinks(query.data, kind)}
      kind={kind}
      isLoading={query.isPending}
      error={
        query.isError ? (
          <QueryError
            error={query.error}
            fallback="Could not load backlinks"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        ) : null
      }
      tabs={
        <DataTableTabs
          value={kind}
          onValueChange={(value) => {
            const next = KINDS.find((item) => item === value);
            if (next) setKind(next);
          }}
          description={
            <>
              {DESCRIPTIONS[kind]}
              {query.data ? <Freshness {...query.data} /> : null}
            </>
          }
        >
          <TabsTrigger value="new">New this week</TabsTrigger>
          <TabsTrigger value="lost">Lost links</TabsTrigger>
          <TabsTrigger value="all">Active links</TabsTrigger>
        </DataTableTabs>
      }
    />
  );
}

type DashboardBacklinksData = Awaited<ReturnType<typeof getDashboardBacklinks>>;
type Backlink =
  | DashboardBacklinksData["value"][number]
  | DashboardBacklinksData["yandex"][number];

// Yandex reports its own link pool, so its rows stay out of the DataForSEO
// arrays server-side and only join the table here — as the "new this week"
// list, sorted by discovery date across both sources.
function withYandexNewLinks(
  data: DashboardBacklinksData | undefined,
  kind: Kind,
): Backlink[] {
  if (!data) return [];
  if (kind !== "new" || data.yandex.length === 0) return data.value;
  return sort([...data.value, ...data.yandex], (a, b) =>
    (b.firstSeen ?? "").localeCompare(a.firstSeen ?? ""),
  );
}

function DashboardBacklinkTable({
  rows,
  kind,
  ...tableProps
}: {
  rows: Backlink[];
  kind: Kind;
} & Pick<
  ComponentProps<typeof DashboardDataTable>,
  "tabs" | "isLoading" | "error"
>) {
  const hasYandex = rows.some((row) => row.source === "yandex_webmaster");
  const columns: ColumnDef<Backlink>[] = [
    {
      id: "urlFrom",
      accessorFn: (row) => `${row.domainFrom ?? ""} ${row.urlFrom ?? ""}`,
      header: ({ column }) => (
        <SortableHeader column={column} label="Referring page" />
      ),
      cell: ({ row }) => (
        <ExternalPage
          url={row.original.urlFrom}
          label={row.original.domainFrom}
        />
      ),
      filterFn: "includesString",
    },
    ...(hasYandex
      ? [
          {
            accessorKey: "source",
            header: "Source",
            cell: ({ row }: { row: { original: Backlink } }) => (
              <Badge variant="outline" size="sm">
                {row.original.source === "yandex_webmaster"
                  ? "Yandex Webmaster"
                  : "DataForSEO"}
              </Badge>
            ),
          } satisfies ColumnDef<Backlink>,
        ]
      : []),
    {
      accessorKey: "anchor",
      header: "Anchor",
      cell: ({ row }) => (
        <span
          className="block max-w-48 truncate"
          title={row.original.anchor ?? undefined}
        >
          {row.original.anchor || "—"}
        </span>
      ),
      filterFn: "includesString",
    },
    {
      accessorKey: "urlTo",
      header: "Target page",
      cell: ({ row }) => <ExternalPage url={row.original.urlTo} />,
      filterFn: "includesString",
    },
    {
      id: "follow",
      // Unknown (Yandex rows, and DataForSEO rows without the attribute) is not
      // a nofollow link — show a dash and let both filters exclude it.
      accessorFn: (row) =>
        row.isDofollow == null ? "" : row.isDofollow ? "Follow" : "Nofollow",
      cell: ({ row }) => {
        const value = row.original.isDofollow;
        return value == null ? "—" : value ? "Follow" : "Nofollow";
      },
      header: "Link type",
      filterFn: "equalsString",
    },
    {
      accessorKey: "domainFromRank",
      header: ({ column }) => (
        <SortableHeader column={column} label="Domain rank" />
      ),
      filterFn: "inNumberRange",
      cell: ({ getValue }) => getValue() ?? "—",
    },
    {
      accessorKey: "spamScore",
      header: ({ column }) => (
        <SortableHeader column={column} label="Spam score" />
      ),
      filterFn: "inNumberRange",
      cell: ({ getValue }) => getValue() ?? "—",
    },
    {
      id: "date",
      accessorFn: (row) =>
        (kind === "lost" ? row.lastSeen : row.firstSeen)?.slice(0, 10) ?? "—",
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label={kind === "lost" ? "Last checked" : "First discovered"}
        />
      ),
    },
  ];
  return (
    <DashboardDataTable
      {...tableProps}
      resetKey={kind}
      rows={rows}
      empty={{
        title:
          kind === "new"
            ? "No new backlinks this week"
            : kind === "lost"
              ? "No lost backlinks found"
              : "No active backlinks found yet",
      }}
      columns={columns}
      filters={[
        { id: "urlFrom", label: "Referring page", kind: "text" },
        { id: "anchor", label: "Anchor text", kind: "text" },
        { id: "urlTo", label: "Target page", kind: "text" },
        { id: "follow", label: "Link type", kind: "follow" },
        { id: "domainFromRank", label: "Domain rank", kind: "number" },
        { id: "spamScore", label: "Spam score", kind: "number" },
      ]}
    />
  );
}
