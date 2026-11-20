import { HelpLabel } from "@/client/components/HelpLabel";
import { useProjectDomainRating } from "@/client/features/domain/hooks/useProjectDomainRating";

/**
 * The project website's domain rating (DataForSEO's 0-100 authority score,
 * Ahrefs-DR-like). Sits beside the searched-domain metrics, so the subtitle
 * names which site the score belongs to.
 */
export function ProjectDomainRatingCard({ projectId }: { projectId: string }) {
  const { data } = useProjectDomainRating(projectId);
  const rank = data?.rank ?? null;

  return (
    <div className="w-full max-w-64 space-y-2 self-start rounded-lg border border-border p-3">
      <HelpLabel
        label="Domain rating"
        helpText="DataForSEO's 0-100 authority score for your project's website, subdomains included. The Backlinks page refreshes it."
      />
      <p className="text-3xl font-semibold tabular-nums">{rank ?? "—"}</p>
      <p className="truncate text-xs text-muted-foreground">
        {data?.domain ?? "Add your website in Project Settings"}
      </p>
    </div>
  );
}
