import { HelpLabel } from "@/client/components/HelpLabel";
import { useProjectSqi } from "@/client/features/domain/hooks/useProjectSqi";

/**
 * The project website's Yandex SQI (ИКС). First-party Webmaster data — works
 * without the DataForSEO key. The subtitle names the connected Yandex site, or
 * why there is no number yet.
 */
export function ProjectSqiCard({ projectId }: { projectId: string }) {
  const { data } = useProjectSqi(projectId);
  const connected = data?.connected === true;
  const sqi = connected ? (data?.sqi ?? null) : null;

  return (
    <div className="w-full max-w-64 space-y-2 self-start rounded-lg border border-border p-3">
      <HelpLabel
        label="Yandex SQI (ИКС)"
        helpText="Yandex's site quality index for the site connected in Yandex Webmaster. First-party data, refreshed daily."
      />
      <p className="text-3xl font-semibold tabular-nums">{sqi ?? "—"}</p>
      <p className="truncate text-xs text-muted-foreground">
        {!data
          ? "Checking Yandex Webmaster…"
          : connected
            ? (data.hostUrl ?? "")
            : data.unavailableReason
              ? data.unavailableReason
              : "Connect Yandex Webmaster in Settings → Integrations"}
      </p>
    </div>
  );
}
