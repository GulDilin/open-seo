import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { getDomainKeywordSuggestions } from "@/serverFunctions/domain";
import {
  addTrackingKeywords,
  getPanelKeywordSuggestions,
} from "@/serverFunctions/rank-tracking";
import { isLabsLocationCode } from "@/client/features/keywords/locations";
import { Spinner } from "@/client/components/Spinner";
import {
  DataTable,
  makeSelectionColumn,
  useDataTable,
} from "@/client/components/table/DataTable";
import { Button } from "@/client/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  applyShiftRangeSelection,
  type SelectionAnchor,
} from "@/client/components/table/tableSelection";
import {
  ConnectPanelsHint,
  PanelSuggestionsTable,
  suggestedKeywordColumns,
  usePanelSuggestionTable,
  type SuggestedKeyword,
} from "./KeywordSuggestionTables";

const PRE_SELECT_COUNT = 20;

type Props = {
  configId: string;
  projectId: string;
  domain: string;
  locationCode: number;
  onDone: (configId: string) => void;
  onClose: () => void;
};

export function KeywordSuggestionStep({
  configId,
  projectId,
  domain,
  locationCode,
  onDone,
  onClose,
}: Props) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [hasInitialized, setHasInitialized] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "traffic", desc: true },
  ]);
  const selectAnchorRef = useRef<SelectionAnchor | null>(null);

  const columns = useMemo<ColumnDef<SuggestedKeyword>[]>(
    () => [
      makeSelectionColumn<SuggestedKeyword>(selectAnchorRef),
      ...suggestedKeywordColumns,
    ],
    [],
  );

  // Ranked-keyword suggestions are Labs-backed; countries served from Google
  // Ads keyword data (e.g. Iceland) have no ranking data to suggest from.
  // The tracker's language is deliberately not sent — rank tracking can pair
  // any SERP language with any country, and the server resolves a Labs-served
  // language for this country (resolveLabsMarket in serverFunctions/domain.ts).
  const labsSupported = isLabsLocationCode(locationCode);
  const suggestionsQuery = useQuery({
    queryKey: ["domainKeywordSuggestions", projectId, domain, locationCode],
    queryFn: () =>
      getDomainKeywordSuggestions({
        data: { projectId, domain, locationCode },
      }),
    enabled: labsSupported,
  });

  // Panel-backed suggestions cover every country — for markets Labs doesn't
  // serve (e.g. Russia) this is the only suggestion source.
  const panelsQuery = useQuery({
    queryKey: ["panelKeywordSuggestions", projectId, domain],
    queryFn: () => getPanelKeywordSuggestions({ data: { projectId, domain } }),
  });
  const panelSuggestions = panelsQuery.data?.suggestions ?? [];
  const panelSources = panelsQuery.data?.sources ?? [];
  const panelsPending = panelsQuery.isPending;

  const panelSelection = usePanelSuggestionTable(panelSuggestions);

  const data = suggestionsQuery.data ?? [];

  // Pre-select top 20 by traffic once data loads.
  useEffect(() => {
    const items = suggestionsQuery.data;
    if (items && items.length > 0 && !hasInitialized) {
      const indexed = items.map((item, i) => ({
        index: i,
        traffic: item.traffic ?? 0,
      }));
      indexed.sort((a, b) => b.traffic - a.traffic);
      const initial: RowSelectionState = {};
      for (let i = 0; i < Math.min(PRE_SELECT_COUNT, indexed.length); i++) {
        initial[indexed[i].index] = true;
      }
      setRowSelection(initial);
      setHasInitialized(true);
    }
  }, [suggestionsQuery.data, hasInitialized]);

  const table = useDataTable({
    data,
    columns,
    state: { rowSelection, sorting },
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    withSorting: true,
    enableRowSelection: true,
  });

  // addTrackingKeywords dedupes, so the same query picked from both tables is
  // added once.
  const selectedKeywords = [
    ...table.getSelectedRowModel().rows.map((row) => row.original.keyword),
    ...panelSelection.selectedQueries,
  ];
  const selectedCount = selectedKeywords.length;
  const totalCount = data.length + panelSuggestions.length;

  const addMutation = useMutation({
    mutationFn: (keywords: string[]) =>
      addTrackingKeywords({ data: { projectId, configId, keywords } }),
    onSuccess: (result) => {
      toast.success(`Added ${result.added} keywords for tracking`);
      onDone(configId);
    },
  });

  const handleAdd = () => {
    if (selectedKeywords.length > 0) {
      addMutation.mutate(selectedKeywords);
    }
  };

  const panelTable = (
    <PanelSuggestionsTable
      table={panelSelection.table}
      anchorRef={panelSelection.anchorRef}
    />
  );
  const footer = (
    <SuggestionsFooter
      selectedCount={selectedCount}
      totalCount={totalCount}
      pending={addMutation.isPending}
      onSkip={onClose}
      onAdd={handleAdd}
    />
  );

  if (!labsSupported) {
    if (panelsPending) {
      return (
        <>
          <StepHeader title="Finding queries from your connected panels..." />
          <div className="flex flex-col items-center justify-center py-16">
            <Spinner label="This usually takes a few seconds" />
          </div>
        </>
      );
    }
    if (panelsQuery.isError || panelSources.length === 0) {
      return (
        <>
          <StepHeader
            title="Add keywords manually"
            description="Ranked-keyword suggestions aren't available for this country. Continue and add the keywords you want to track manually."
          />
          <ConnectPanelsHint projectId={projectId} />
          <DialogFooter>
            <Button onClick={onClose}>Continue</Button>
          </DialogFooter>
        </>
      );
    }
    if (panelSuggestions.length === 0) {
      return (
        <>
          <StepHeader
            title="No new queries found"
            description="Every query your connected panels reported is already tracked in this project. Continue and add keywords manually."
          />
          <DialogFooter>
            <Button onClick={onClose}>Continue</Button>
          </DialogFooter>
        </>
      );
    }
    return (
      <>
        <StepHeader
          title="Choose keywords to track"
          description={`Top queries ${domain} already shows up for in your connected panels.`}
        />
        {panelTable}
        {footer}
      </>
    );
  }

  if (suggestionsQuery.isLoading) {
    return (
      <>
        <StepHeader title="Finding your top keywords..." />
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner label="This usually takes a few seconds" />
        </div>
      </>
    );
  }

  // Labs failed or found nothing — panels may still have queries, so wait for
  // them before declaring the step empty.
  if (data.length === 0 || suggestionsQuery.isError) {
    if (panelsPending) {
      return (
        <>
          <StepHeader
            title={
              suggestionsQuery.isError
                ? "Couldn't fetch keywords"
                : "No rankings found"
            }
            description="You can skip this step and add keywords manually later."
          />
          <div className="flex flex-col items-center justify-center py-16">
            <Spinner label="Checking your connected panels..." />
          </div>
        </>
      );
    }
    if (panelSuggestions.length === 0) {
      return (
        <>
          <StepHeader
            title={
              suggestionsQuery.isError
                ? "Couldn't fetch keywords"
                : "No rankings found"
            }
            description={
              suggestionsQuery.isError
                ? "You can skip this step and add keywords manually later."
                : `We couldn't find any keywords ${domain} currently ranks for. You can add keywords manually.`
            }
          />
          {panelSources.length === 0 ? (
            <ConnectPanelsHint projectId={projectId} />
          ) : null}
          <DialogFooter>
            <Button onClick={onClose}>Skip</Button>
          </DialogFooter>
        </>
      );
    }
    return (
      <>
        <StepHeader
          title="Choose keywords to track"
          description={`We couldn't find ranked keywords for ${domain}, but your connected panels report these queries.`}
        />
        {panelTable}
        {footer}
      </>
    );
  }

  return (
    <>
      <StepHeader
        title="Choose keywords to track"
        description={`We found ${data.length} keywords ${domain} ranks for.`}
      />

      <DataTable
        table={table}
        empty={{ title: "No keywords" }}
        scrollClassName="max-h-[400px]"
        onRowClick={(row, event) => {
          if (applyShiftRangeSelection(event, row, table, selectAnchorRef)) {
            return;
          }
          row.toggleSelected();
        }}
      />

      {panelSuggestions.length > 0 ? panelTable : null}

      {footer}
    </>
  );
}

function SuggestionsFooter({
  selectedCount,
  totalCount,
  pending,
  onSkip,
  onAdd,
}: {
  selectedCount: number;
  totalCount: number;
  pending: boolean;
  onSkip: () => void;
  onAdd: () => void;
}) {
  return (
    <DialogFooter className="items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        {selectedCount} of {totalCount} selected
      </p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onSkip}>
          Skip
        </Button>
        <Button
          onClick={onAdd}
          pending={pending}
          disabled={selectedCount === 0}
        >
          Save Keyword{selectedCount !== 1 ? "s" : ""}
        </Button>
      </div>
    </DialogFooter>
  );
}

function StepHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      {description ? (
        <DialogDescription>{description}</DialogDescription>
      ) : null}
    </DialogHeader>
  );
}
