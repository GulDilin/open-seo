import { useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Link } from "@tanstack/react-router";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import type { getPanelKeywordSuggestions } from "@/serverFunctions/rank-tracking";
import {
  DataTable,
  makeSelectionColumn,
  useDataTable,
} from "@/client/components/table/DataTable";
import { Badge } from "@/client/components/ui/badge";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { RANK_TRACKING_HEADER_CLASS } from "./RankTrackingColumns";
import {
  applyShiftRangeSelection,
  type SelectionAnchor,
} from "@/client/components/table/tableSelection";

type PanelSuggestionsResult = Awaited<
  ReturnType<typeof getPanelKeywordSuggestions>
>;
type PanelSuggestion = PanelSuggestionsResult["suggestions"][number];
type PanelSource = PanelSuggestionsResult["sources"][number];

const SOURCE_LABELS: Record<PanelSource, string> = {
  gsc: "Google",
  yandex_webmaster: "Yandex",
};

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const panelBaseColumns: ColumnDef<PanelSuggestion>[] = [
  {
    id: "query",
    accessorKey: "query",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Keyword"
        title="The search term, as reported by the connected panel"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>()}</span>
    ),
    sortingFn: "alphanumeric",
  },
  {
    id: "source",
    accessorKey: "source",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Source"
        title="Which connected panel reported this query"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => (
      <Badge variant="secondary" size="sm">
        {SOURCE_LABELS[getValue<PanelSource>()]}
      </Badge>
    ),
  },
  {
    id: "impressions",
    accessorKey: "impressions",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Shows"
        title="Times the site appeared in search over the last 28 days"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => compactNumber.format(getValue<number>()),
  },
  {
    id: "clicks",
    accessorKey: "clicks",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Clicks"
        title="Clicks from search over the last 28 days"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => compactNumber.format(getValue<number>()),
  },
];

export type SuggestedKeyword = {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  traffic: number | null;
};

export const suggestedKeywordColumns: ColumnDef<SuggestedKeyword>[] = [
  {
    id: "keyword",
    accessorKey: "keyword",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Keyword"
        title="The search term this domain ranks for"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>()}</span>
    ),
    sortingFn: "alphanumeric",
  },
  {
    id: "position",
    accessorKey: "position",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Position"
        title="Current Google ranking position"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => {
      const pos = getValue<number | null>();
      return pos != null ? (
        pos
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.position ?? 999;
      const b = rowB.original.position ?? 999;
      return a - b;
    },
  },
  {
    id: "searchVolume",
    accessorKey: "searchVolume",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Volume"
        title="Monthly search volume"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => {
      const vol = getValue<number | null>();
      return vol != null ? (
        vol.toLocaleString()
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.searchVolume ?? 0;
      const b = rowB.original.searchVolume ?? 0;
      return a - b;
    },
  },
  {
    id: "traffic",
    accessorKey: "traffic",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Traffic"
        title="Estimated monthly organic traffic"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => {
      const traffic = getValue<number | null>();
      return traffic != null ? (
        Math.round(traffic).toLocaleString()
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.traffic ?? 0;
      const b = rowB.original.traffic ?? 0;
      return a - b;
    },
  },
];

/** Selection table for panel-backed suggestions — same mechanics as the Labs
 *  suggestion table (row click toggles, shift-click selects a range). */
export function usePanelSuggestionTable(suggestions: PanelSuggestion[]) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "impressions", desc: true },
  ]);
  const anchorRef = useRef<SelectionAnchor | null>(null);

  const columns = useMemo<ColumnDef<PanelSuggestion>[]>(
    () => [
      makeSelectionColumn<PanelSuggestion>(anchorRef),
      ...panelBaseColumns,
    ],
    [],
  );

  const table = useDataTable({
    data: suggestions,
    columns,
    state: { rowSelection, sorting },
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    withSorting: true,
    enableRowSelection: true,
  });

  return {
    table,
    anchorRef,
    selectedQueries: table
      .getSelectedRowModel()
      .rows.map((row) => row.original.query),
  };
}

export function PanelSuggestionsTable({
  table,
  anchorRef,
}: {
  table: TanStackTable<PanelSuggestion>;
  anchorRef: MutableRefObject<SelectionAnchor | null>;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">From your connected panels</h3>
        <p className="text-xs text-muted-foreground">
          Queries the site already shows up for in Google Search Console and
          Yandex Webmaster over the last 28 days. Keywords already tracked in
          this project are hidden.
        </p>
      </div>
      <DataTable
        table={table}
        empty={{ title: "No queries" }}
        scrollClassName="max-h-[240px]"
        onRowClick={(row, event) => {
          if (applyShiftRangeSelection(event, row, table, anchorRef)) {
            return;
          }
          row.toggleSelected();
        }}
      />
    </div>
  );
}

export function ConnectPanelsHint({ projectId }: { projectId: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Connect Yandex Webmaster or Google Search Console in{" "}
      <Link
        to="/p/$projectId/settings/integrations"
        params={{ projectId }}
        className="font-medium text-foreground underline underline-offset-4"
      >
        Integrations
      </Link>{" "}
      to see queries your site already shows up for.
    </p>
  );
}
