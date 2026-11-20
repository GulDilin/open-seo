import { Link } from "@tanstack/react-router";
import { CardShell } from "@/client/components/CardShell";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  DataForSeoRequiredBadge,
  useSeoProviderSetup,
} from "@/client/components/ProviderRequiredBadge";
import { useProjectDomainRating } from "@/client/features/domain/hooks/useProjectDomainRating";
import { useProjectSqi } from "@/client/features/domain/hooks/useProjectSqi";

function Stat({
  label,
  value,
  reason,
}: {
  label: string;
  value: string | null;
  reason: string | null;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value ?? "—"}</p>
      <p className="truncate text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

/**
 * The project website's authority scores side by side: DataForSEO's domain
 * rating and Yandex's SQI (ИКС). Each stat degrades to an honest dash with
 * the reason — the rating needs the DataForSEO key, SQI needs a connected
 * Yandex Webmaster site.
 */
export function DashboardDomainRatingCard({
  projectId,
}: {
  projectId: string;
}) {
  const setup = useSeoProviderSetup();
  const ratingQuery = useProjectDomainRating(projectId);
  const sqiQuery = useProjectSqi(projectId);
  const rating = ratingQuery.data;
  const sqi = sqiQuery.data;

  // The rating needs DataForSEO; without its key the lookup returns null —
  // say so instead of an unexplained dash.
  const noDataForSeo = setup.data != null && !setup.data.dataforseo;
  const ratingReason = !rating
    ? null
    : rating.domain == null
      ? "Add your website in Project settings"
      : rating.rank == null && noDataForSeo
        ? "Needs the DataForSEO key"
        : rating.rank == null
          ? "No rating yet — the Backlinks page refreshes it"
          : rating.domain;
  const sqiReason = !sqi
    ? null
    : sqi.connected
      ? sqi.sqi != null
        ? sqi.hostUrl
        : "Yandex has no value for this site yet"
      : sqi.unavailableReason
        ? sqi.unavailableReason
        : "Connect Yandex Webmaster in Settings → Integrations";

  return (
    <CardShell
      title="Domain rating"
      action={
        <Link
          to="/p/$projectId/domain"
          params={{ projectId }}
          className="text-sm text-primary hover:underline"
        >
          Domain overview →
        </Link>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ratingQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-16" />
          </div>
        ) : (
          <Stat
            label="Domain rating"
            value={rating?.rank != null ? String(rating.rank) : null}
            reason={ratingReason}
          />
        )}
        {sqiQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-16" />
          </div>
        ) : (
          <Stat
            label="Yandex SQI (ИКС)"
            value={sqi?.connected && sqi.sqi != null ? String(sqi.sqi) : null}
            reason={sqiReason}
          />
        )}
      </div>
      {noDataForSeo ? (
        <div className="mt-4">
          <DataForSeoRequiredBadge />
        </div>
      ) : null}
    </CardShell>
  );
}
