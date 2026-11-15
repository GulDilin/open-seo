import { useId, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTrackingKeywords,
  getPanelKeywordSuggestions,
} from "@/serverFunctions/rank-tracking";
import { MAX_TRACKED_KEYWORD_LENGTH } from "@/shared/rank-tracking";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import {
  PanelSuggestionsTable,
  usePanelSuggestionTable,
} from "./KeywordSuggestionTables";

export function AddKeywordsPanel({
  configId,
  projectId,
  domain,
  onSuccess,
  onCancel,
}: {
  configId: string;
  projectId: string;
  domain: string;
  onSuccess: (result: {
    added: number;
    checkTriggered: boolean;
    checkScheduledSoon: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const matchCaseId = useId();
  const queryClient = useQueryClient();
  const [keywordInput, setKeywordInput] = useState("");
  const [matchCase, setMatchCase] = useState(false);

  // Same panel-backed suggestions as the new-tracker wizard: queries the
  // site already shows up for in GSC / Yandex Webmaster, minus keywords any
  // active tracker in this project already tracks.
  const panelsQuery = useQuery({
    queryKey: ["panelKeywordSuggestions", projectId, domain],
    queryFn: () => getPanelKeywordSuggestions({ data: { projectId, domain } }),
  });
  const panelSuggestions = panelsQuery.data?.suggestions ?? [];
  const panelSelection = usePanelSuggestionTable(panelSuggestions);

  const mutation = useMutation({
    mutationFn: (kws: string[]) =>
      addTrackingKeywords({
        data: { projectId, configId, keywords: kws, matchCase },
      }),
    onSuccess: (result) => {
      setKeywordInput("");
      // Added queries drop out of the panel list server-side (now tracked);
      // refresh so the table shrinks instead of offering them again.
      void queryClient.invalidateQueries({
        queryKey: ["panelKeywordSuggestions", projectId],
      });
      onSuccess(result);
    },
  });
  const isPending = mutation.isPending;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Textarea
            rows={3}
            // The field grows with its text; a long line must wrap, not widen the card.
            className="min-w-0"
            aria-label="Keywords to add"
            placeholder="Enter keywords, one per line"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
          />
          <div
            className="flex w-fit items-center gap-2"
            title="Track these keywords exactly as typed instead of lowercasing them. Google can return different results for a capitalized brand name."
          >
            <Checkbox
              id={matchCaseId}
              checked={matchCase}
              onCheckedChange={(checked) => setMatchCase(checked)}
            />
            <Label htmlFor={matchCaseId} className="text-xs font-normal">
              Match case
            </Label>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            pending={isPending}
            onClick={() => {
              const lines = keywordInput
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);
              if (lines.some((l) => l.length > MAX_TRACKED_KEYWORD_LENGTH)) {
                toast.error(
                  `Keywords must be ${MAX_TRACKED_KEYWORD_LENGTH} characters or fewer.`,
                );
                return;
              }
              // addTrackingKeywords dedupes, so picked panel queries can sit
              // next to typed lines in one call.
              const keywords = [
                ...lines,
                ...panelSelection.selectedQueries,
              ].filter(Boolean);
              if (keywords.length > 0) mutation.mutate(keywords);
            }}
            disabled={
              !(keywordInput.trim() || panelSelection.selectedQueries.length)
            }
          >
            Add
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      {panelSuggestions.length > 0 ? (
        <PanelSuggestionsTable
          table={panelSelection.table}
          anchorRef={panelSelection.anchorRef}
        />
      ) : null}
    </div>
  );
}
