import { HelpLabel } from "@/client/components/HelpLabel";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  DOMAIN_RATING_SOURCE_LABELS,
  useProjectDomainRating,
} from "@/client/features/domain/hooks/useProjectDomainRating";

/**
 * The project website's domain rating (Ahrefs-DR-like 0-100 authority score).
 * Sits beside the searched-domain metrics, so the subtitle names which site
 * the score belongs to and which provider supplied it. When no provider could
 * rate the site, the reason replaces the number instead of a bare dash.
 */
export function ProjectDomainRatingCard({ projectId }: { projectId: string }) {
  const { data } = useProjectDomainRating(projectId);
  // The server sends raw error messages and codes; humanize them the same way
  // the rest of the app does.
  const reason = data?.reason
    ? getStandardErrorMessage(new Error(data.reason))
    : null;
  const source =
    data?.rank != null && data.source
      ? DOMAIN_RATING_SOURCE_LABELS[data.source]
      : null;
  const subtitle =
    data?.rank != null
      ? [data.domain, source].filter(Boolean).join(" · ")
      : (reason ?? data?.domain ?? "Add your website in Project Settings");

  return (
    <div className="w-full max-w-64 space-y-2 self-start rounded-lg border border-border p-3">
      <HelpLabel
        label="Domain rating"
        helpText="Ahrefs-DR-style 0-100 authority score for your project's website, subdomains included: DataForSEO's backlinks rank, with the free Ahrefs DR as a fallback."
      />
      <p className="text-3xl font-semibold tabular-nums">{data?.rank ?? "—"}</p>
      <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
