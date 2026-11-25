import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { QueryError } from "@/client/components/QueryState";
import { CardShell } from "@/client/components/CardShell";
import { PermissionHint } from "@/client/components/PermissionHint";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  disconnectBing,
  getBingConnection,
  listBingSites,
  setBingSite,
} from "@/serverFunctions/bingWebmaster";

type SiteEntry = {
  siteUrl: string;
  verified: boolean;
  isSelected: boolean;
};

function SitePickerRow({
  site,
  selected,
  onSelect,
}: {
  site: SiteEntry;
  selected: boolean;
  onSelect: (site: SiteEntry) => void;
}) {
  return (
    <button
      key={site.siteUrl}
      type="button"
      disabled={!site.verified}
      aria-pressed={selected}
      title={site.verified ? undefined : "Not verified in Bing Webmaster"}
      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-accent"
      } ${site.verified ? "" : "cursor-not-allowed opacity-50"}`}
      onClick={() => site.verified && onSelect(site)}
    >
      <span className="min-w-0 truncate">{site.siteUrl}</span>
      {!site.verified ? <Badge variant="outline">Unverified</Badge> : null}
    </button>
  );
}

function BingConnectedState({
  siteUrl,
  connectedAt,
  canManage,
  changing,
  disconnecting,
  onChange,
  onDisconnect,
}: {
  siteUrl: string;
  connectedAt: string | null;
  canManage: boolean;
  changing: boolean;
  disconnecting: boolean;
  onChange: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold">{siteUrl}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Connected {connectedAt?.slice(0, 10)}
        </p>
      </div>
      {canManage ? (
        <fieldset disabled={changing} className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={onChange}>
            Change site
          </Button>
          <Button variant="destructive" size="sm" onClick={onDisconnect}>
            {disconnecting ? "Disconnecting…" : "Disconnect project"}
          </Button>
        </fieldset>
      ) : null}
    </div>
  );
}

/** The site list behind the typed API key, or behind the project's stored key
 *  when the flow started from "Change site" (empty apiKey). The key lives only
 *  in this component's state — it is sent when sites are loaded and again when
 *  the chosen site is saved, and never comes back. */
function BingSitePicker({
  projectId,
  apiKey,
  changing,
  selection,
  saving,
  onSelect,
  onCancel,
  onSave,
}: {
  projectId: string;
  apiKey: string;
  changing: boolean;
  selection: SiteEntry | null;
  saving: boolean;
  onSelect: (site: SiteEntry) => void;
  onCancel: () => void;
  onSave: (site: SiteEntry) => void;
}) {
  const sitesQuery = useQuery({
    queryKey: ["bingSites", projectId, apiKey],
    // An empty apiKey means the stored key is used server-side.
    queryFn: () =>
      listBingSites({
        data: apiKey ? { projectId, apiKey } : { projectId },
      }),
    staleTime: Infinity,
  });
  const sites: SiteEntry[] = sitesQuery.data?.sites ?? [];

  return (
    <fieldset disabled={changing} className="space-y-3">
      {sitesQuery.isPending ? (
        <div role="status" aria-label="Loading sites" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : sitesQuery.isError ? (
        <QueryError
          error={sitesQuery.error}
          fallback="Bing Webmaster rejected that API key."
          onRetry={() => void sitesQuery.refetch()}
          isRetrying={sitesQuery.isFetching}
        />
      ) : (
        <>
          <div className="space-y-1">
            {sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sites on that Bing Webmaster account yet — add and verify one
                at bing.com/webmasters first.
              </p>
            ) : null}
            {sites.map((site) => (
              <SitePickerRow
                key={site.siteUrl}
                site={site}
                selected={
                  selection
                    ? selection.siteUrl === site.siteUrl
                    : site.isSelected
                }
                onSelect={onSelect}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              pending={saving}
              disabled={!selection}
              onClick={() => selection && onSave(selection)}
            >
              Save site
            </Button>
          </div>
        </>
      )}
    </fieldset>
  );
}

/** The API-key form. Submitting it loads the sites the key can see; the key is
 *  kept in state until a site is saved or the flow is cancelled. */
function ApiKeyForm({
  changing,
  onSubmit,
}: {
  changing: boolean;
  onSubmit: (apiKey: string) => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (apiKey.trim()) onSubmit(apiKey.trim());
      }}
    >
      <p className="text-sm text-muted-foreground">
        Paste the API key Bing Webmaster generated (Settings → API access) to
        list its sites.
      </p>
      <Input
        type="password"
        autoComplete="off"
        placeholder="Bing Webmaster API key"
        aria-label="Bing Webmaster API key"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          pending={changing}
          disabled={!apiKey.trim()}
        >
          Load sites
        </Button>
      </div>
    </form>
  );
}

/**
 * Connects one project to Bing Webmaster: enter an API key, pick a verified
 * site, change it, or disconnect. Bing has no OAuth flow — the static key is
 * stored encrypted with the site. The Yandex sibling's card, simplified for a
 * single-step credential.
 */
export function BingConnectionCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<SiteEntry | null>(null);

  const connectionQuery = useQuery({
    queryKey: ["bingConnection", projectId],
    queryFn: () => getBingConnection({ data: { projectId } }),
  });
  const connection = connectionQuery.data;
  const connected = Boolean(connection?.connected);
  const canManage = connection?.canManage === true;
  const picking = apiKey !== null;

  const afterChange = () => {
    queryClient.removeQueries({ queryKey: ["bingSites", projectId] });
    void queryClient.invalidateQueries({
      queryKey: ["bingConnection", projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["bingSearchPerformance", projectId],
    });
    void queryClient.invalidateQueries({ queryKey: ["bingLinks", projectId] });
    setApiKey(null);
    setSelection(null);
  };

  const setSiteMutation = useMutation({
    meta: { errorToast: false },
    mutationFn: (site: SiteEntry) =>
      setBingSite({
        data: apiKey
          ? { projectId, apiKey, siteUrl: site.siteUrl }
          : { projectId, siteUrl: site.siteUrl },
      }),
    onSuccess: () => {
      toast.success("Bing Webmaster connected");
      afterChange();
    },
  });
  const disconnectMutation = useMutation({
    meta: { errorToast: false },
    mutationFn: () => disconnectBing({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Bing Webmaster disconnected from this project");
      afterChange();
    },
  });

  const changing = setSiteMutation.isPending || disconnectMutation.isPending;

  return (
    <CardShell
      title="Bing Webmaster"
      action={
        connectionQuery.isPending || connectionQuery.isError ? undefined : (
          <Badge variant={connected ? "success" : "outline"}>
            <span className="size-1.5 rounded-full bg-current" />
            {connected ? "Connected" : "Not connected"}
          </Badge>
        )
      }
    >
      {connectionQuery.isPending ? (
        <div
          role="status"
          aria-label="Loading connection"
          className="space-y-3"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-24" />
        </div>
      ) : connectionQuery.isError && !connection ? (
        <QueryError
          error={connectionQuery.error}
          fallback="Couldn't check this project's Bing connection."
          onRetry={() => void connectionQuery.refetch()}
          isRetrying={connectionQuery.isFetching}
        />
      ) : connected && !picking ? (
        <BingConnectedState
          siteUrl={connection?.siteUrl ?? ""}
          connectedAt={connection?.connectedAt ?? null}
          canManage={canManage}
          changing={changing}
          disconnecting={disconnectMutation.isPending}
          onChange={() => setApiKey("")}
          onDisconnect={() => disconnectMutation.mutate()}
        />
      ) : picking ? (
        <BingSitePicker
          projectId={projectId}
          apiKey={apiKey ?? ""}
          changing={changing}
          selection={selection}
          saving={setSiteMutation.isPending}
          onSelect={setSelection}
          onCancel={() => {
            setApiKey(null);
            setSelection(null);
            setSiteMutation.reset();
          }}
          onSave={(site) => setSiteMutation.mutate(site)}
        />
      ) : (
        <ApiKeyForm changing={changing} onSubmit={(key) => setApiKey(key)} />
      )}
      {setSiteMutation.isError || disconnectMutation.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {getStandardErrorMessage(
            setSiteMutation.error ?? disconnectMutation.error,
          )}
        </p>
      ) : null}
      {connectionQuery.isSuccess && !canManage ? (
        <PermissionHint
          action="change this project's Bing connection"
          className="mt-3"
        />
      ) : null}
    </CardShell>
  );
}
