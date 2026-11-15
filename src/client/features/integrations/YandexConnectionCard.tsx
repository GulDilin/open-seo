import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { QueryError } from "@/client/components/QueryState";
import { CardShell } from "@/client/components/CardShell";
import { PermissionHint } from "@/client/components/PermissionHint";
import { GoogleOAuthSetupWarning } from "@/client/features/integrations/GoogleOAuthSetupWarning";
import { YandexLinkErrorAlert } from "@/client/features/integrations/yandexLinkErrorAlert";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  startYandexLink,
  useYandexPickerResume,
} from "@/client/features/integrations/startYandexLink";
import {
  disconnectYandex,
  getYandexConnection,
  listYandexSites,
  setYandexSite,
} from "@/serverFunctions/yandexWebmaster";
import { YANDEX_SELF_HOSTED_SETUP_DOCS_URL } from "@/shared/yandex-webmaster";

/** One selectable Yandex site, flattened with the grant (uid) it came from. */
type SiteEntry = {
  accountId: string;
  hostId: string;
  hostUrl: string;
  verified: boolean;
  isSelected: boolean;
};

type AccountStatus = {
  accountId: string;
  requiresReconnect: boolean;
  sitesUnavailable: boolean;
  sites: Array<{
    hostId: string;
    hostUrl: string;
    verified: boolean;
    isSelected: boolean;
  }>;
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
      key={site.hostId}
      type="button"
      disabled={!site.verified}
      aria-pressed={selected}
      title={site.verified ? undefined : "Not verified in Yandex Webmaster"}
      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-accent"
      } ${site.verified ? "" : "cursor-not-allowed opacity-50"}`}
      onClick={() => site.verified && onSelect(site)}
    >
      <span className="min-w-0 truncate">{site.hostUrl}</span>
      {!site.verified ? <Badge variant="outline">Unverified</Badge> : null}
    </button>
  );
}

function YandexConnectedState({
  hostUrl,
  connectedAt,
  canManage,
  changing,
  disconnecting,
  onChange,
  onDisconnect,
}: {
  hostUrl: string;
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
        <p className="break-words text-sm font-semibold">{hostUrl}</p>
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

/** The verified-site list plus its own loading/error/reconnect states. */
function YandexSitePicker({
  projectId,
  changing,
  selection,
  saving,
  onSelect,
  onCancel,
  onSave,
  onReconnect,
}: {
  projectId: string;
  changing: boolean;
  selection: SiteEntry | null;
  saving: boolean;
  onSelect: (site: SiteEntry) => void;
  onCancel: () => void;
  onSave: (site: SiteEntry) => void;
  onReconnect: () => void;
}) {
  const accountsQuery = useQuery({
    queryKey: ["yandexSites", projectId],
    queryFn: () => listYandexSites({ data: { projectId } }),
  });
  const accounts: AccountStatus[] = accountsQuery.data?.accounts ?? [];
  const sites: SiteEntry[] = accounts.flatMap((account) =>
    account.sites.map((site) => ({ ...site, accountId: account.accountId })),
  );
  const requiresReconnect = accounts.some(
    (account) => account.requiresReconnect,
  );
  // A failed hosts call must not read as "the account has no sites" — that
  // sends the user to webmaster.yandex.ru for a list Yandex never returned.
  const sitesUnavailable = accounts.some(
    (account) => account.sitesUnavailable,
  );

  return (
    <fieldset disabled={changing} className="space-y-3">
      {requiresReconnect ? (
        <p role="alert" className="text-sm text-destructive">
          The Yandex connection has expired or was revoked.{" "}
          <button type="button" className="underline" onClick={onReconnect}>
            Reconnect Yandex
          </button>
        </p>
      ) : null}
      {accountsQuery.isPending ? (
        <div role="status" aria-label="Loading sites" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : accountsQuery.isError ? (
        <QueryError
          error={accountsQuery.error}
          fallback="Couldn't load your Yandex Webmaster sites."
          onRetry={() => void accountsQuery.refetch()}
          isRetrying={accountsQuery.isFetching}
        />
      ) : (
        <>
          <div className="space-y-1">
            {sites.length === 0 && sitesUnavailable ? (
              <p role="alert" className="text-sm text-destructive">
                Couldn't load sites from Yandex Webmaster.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void accountsQuery.refetch()}
                >
                  Try again
                </button>
              </p>
            ) : sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sites in this Yandex Webmaster account yet — add and verify
                one at webmaster.yandex.ru first.
              </p>
            ) : null}
            {sites.map((site) => (
              <SitePickerRow
                key={site.hostId}
                site={site}
                selected={
                  selection ? selection.hostId === site.hostId : site.isSelected
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

/**
 * Connects one project to Yandex Webmaster: authorize a Yandex account, pick a
 * verified site, change it, or disconnect. The Yandex sibling of
 * GoogleConnectionCard, simplified to the single-grant-per-user reality of the
 * Yandex flow (several Yandex accounts are still listed if connected).
 */
export function YandexConnectionCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = React.useState<SiteEntry | null>(null);
  const { picking, setPicking, resumeKey } = useYandexPickerResume(projectId);
  const [linking, setLinking] = React.useState(false);

  const connectionQuery = useQuery({
    queryKey: ["yandexConnection", projectId],
    queryFn: () => getYandexConnection({ data: { projectId } }),
  });
  const connection = connectionQuery.data;
  const connected = Boolean(connection?.connected);
  const hasGrant = Boolean(connection?.currentUserHasGrant);
  const canManage = connection?.canManage === true;
  const needsSetup =
    connectionQuery.isSuccess && !connection?.yandexOAuthConfigured;

  const showPicker = picking ?? (!connected && hasGrant && canManage);

  const afterChange = () => {
    queryClient.removeQueries({ queryKey: ["yandexSites", projectId] });
    void queryClient.invalidateQueries({
      queryKey: ["yandexConnection", projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["yandexSearchPerformance", projectId],
    });
    setPicking(false);
  };

  const setSiteMutation = useMutation({
    meta: { errorToast: false },
    mutationFn: (site: SiteEntry) =>
      setYandexSite({
        data: { projectId, accountId: site.accountId, hostId: site.hostId },
      }),
    onSuccess: () => {
      toast.success("Yandex Webmaster connected");
      afterChange();
    },
  });
  const disconnectMutation = useMutation({
    meta: { errorToast: false },
    mutationFn: () => disconnectYandex({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Yandex Webmaster disconnected from this project");
      setSelection(null);
      afterChange();
    },
  });

  const linkAccount = async () => {
    setLinking(true);
    await startYandexLink(window.location.href, resumeKey);
    setLinking(false);
  };

  const changing =
    setSiteMutation.isPending || disconnectMutation.isPending || linking;

  return (
    <CardShell
      title="Yandex Webmaster"
      action={
        connectionQuery.isPending ||
        connectionQuery.isError ||
        needsSetup ? undefined : (
          <Badge variant={connected ? "success" : "outline"}>
            <span className="size-1.5 rounded-full bg-current" />
            {connected ? "Connected" : "Not connected"}
          </Badge>
        )
      }
    >
      <YandexLinkErrorAlert />
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
          fallback="Couldn't check this project's Yandex connection."
          onRetry={() => void connectionQuery.refetch()}
          isRetrying={connectionQuery.isFetching}
        />
      ) : needsSetup ? (
        <GoogleOAuthSetupWarning
          integrationName="Yandex Webmaster"
          docsUrl={YANDEX_SELF_HOSTED_SETUP_DOCS_URL}
        />
      ) : connected && !picking ? (
        <YandexConnectedState
          hostUrl={connection?.hostUrl ?? ""}
          connectedAt={connection?.connectedAt ?? null}
          canManage={canManage}
          changing={changing}
          disconnecting={disconnectMutation.isPending}
          onChange={() => setPicking(true)}
          onDisconnect={() => disconnectMutation.mutate()}
        />
      ) : showPicker ? (
        <YandexSitePicker
          projectId={projectId}
          changing={changing}
          selection={selection}
          saving={setSiteMutation.isPending}
          onSelect={setSelection}
          onCancel={() => {
            setPicking(false);
            setSelection(null);
            setSiteMutation.reset();
          }}
          onSave={(site) => setSiteMutation.mutate(site)}
          onReconnect={() => void linkAccount()}
        />
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {hasGrant
              ? "Choose a Yandex Webmaster site to finish connecting this project."
              : "Connect Yandex Webmaster to see this project's Yandex search performance."}
          </p>
          <div className="mt-auto flex justify-end">
            {canManage || hasGrant ? (
              <Button
                variant={hasGrant ? "outline" : "default"}
                size="sm"
                pending={linking}
                onClick={() =>
                  hasGrant ? setPicking(true) : void linkAccount()
                }
              >
                {linking
                  ? "Opening Yandex…"
                  : hasGrant
                    ? "Choose site"
                    : "Connect"}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {setSiteMutation.isError || disconnectMutation.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {getStandardErrorMessage(
            setSiteMutation.error ?? disconnectMutation.error,
          )}
        </p>
      ) : null}
      {connectionQuery.isSuccess && !needsSetup && !canManage ? (
        <PermissionHint
          action="change this project's Yandex connection"
          className="mt-3"
        />
      ) : null}
    </CardShell>
  );
}
