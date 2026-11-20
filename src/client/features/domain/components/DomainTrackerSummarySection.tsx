import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Smartphone, TrendingUp } from "lucide-react";
import { QueryState } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { EmptyState } from "@/client/components/EmptyState";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import {
  RankVisibilityChart,
  RankVisibilityTiles,
} from "@/client/features/rank-tracking/RankVisibilityChart";
import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  getDomainTrackerSummary,
  getRankTrackingConfigSummaries,
} from "@/serverFunctions/rank-tracking";
import { SEARCH_ENGINE_LABELS } from "@/shared/search-engines";
import { parseResearchTarget } from "@/shared/researchScope";
import type {
  DomainTrackerEngineSummary,
  DomainTrackerTopPage,
} from "@/types/schemas/rank-tracking";

/** Days of position history the section charts. */
const TREND_SINCE_DAYS = 90;

/** The searched domain is a different site than the project's own — the
 *  tracker summary (which always describes the project's domain) would be
 *  wrong beside those results, so the section hides. */
function isForeignDomain(searchedDomain: string | null, projectDomain: string) {
  if (!searchedDomain) return false;
  const parsed = parseResearchTarget(searchedDomain);
  return !(parsed.ok && parsed.target.hostname === projectDomain);
}

/** Per-engine position tracking for the project's own domain: one block per
 *  connected tracker engine, each with its visibility tiles, position chart,
 *  and top ranking pages. Free first-party tracker data — shown without
 *  DataForSEO. Renders nothing until trackers on the project's domain exist. */
export function DomainTrackerSummarySection({
  projectId,
  searchedDomain = null,
}: {
  projectId: string;
  /** The domain the page is currently researching, if any. */
  searchedDomain?: string | null;
}) {
  // Null until the user picks — the default follows what the in-scope
  // trackers actually check, so a mobile-only tracker doesn't open onto an
  // all-zero desktop view.
  const [deviceOverride, setDeviceOverride] = useState<
    "desktop" | "mobile" | null
  >(null);

  const configsQuery = useQuery({
    queryKey: ["rankTrackingConfigSummaries", projectId],
    queryFn: () => getRankTrackingConfigSummaries({ data: { projectId } }),
  });
  const projectsQuery = useQuery(projectsQueryOptions());
  const projectDomain =
    projectsQuery.data?.find((project) => project.id === projectId)?.domain ??
    null;

  const configs = configsQuery.data ?? [];
  const matching =
    projectDomain !== null
      ? configs.filter((config) => config.domain === projectDomain)
      : [];
  const device =
    deviceOverride ??
    (matching.some((config) => config.devices !== "mobile")
      ? "desktop"
      : "mobile");

  // Disabled rather than skipped so the hook order is stable when there is
  // nothing to summarize.
  const summaryQuery = useQuery({
    queryKey: ["domainTrackerSummary", projectId, device],
    enabled: matching.length > 0,
    queryFn: () =>
      getDomainTrackerSummary({
        data: { projectId, device, sinceDays: TREND_SINCE_DAYS },
      }),
  });

  // Hidden, never stubbed: while the project resolves, on lookup errors, with
  // no project domain or no tracker on it, and while the page researches a
  // different domain.
  if (
    projectsQuery.isPending ||
    configsQuery.isPending ||
    configsQuery.isError ||
    projectDomain === null ||
    matching.length === 0 ||
    isForeignDomain(searchedDomain, projectDomain)
  ) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Position tracking</h2>
          <p className="text-xs text-muted-foreground">
            {projectDomain} — from your connected rank trackers.
          </p>
        </div>
        <SegmentedToggle
          items={[
            {
              value: "desktop" as const,
              icon: <Monitor className="size-3.5" />,
              label: "Desktop",
            },
            {
              value: "mobile" as const,
              icon: <Smartphone className="size-3.5" />,
              label: "Mobile",
            },
          ]}
          value={device}
          onChange={setDeviceOverride}
        />
      </div>

      <QueryState
        query={summaryQuery}
        errorFallback="Failed to load tracker summary"
        loading={<Skeleton className="h-[280px] w-full" />}
      >
        {(data) => (
          <div className="space-y-3">
            {data.engines.map((engine) => (
              <EngineBlock
                key={engine.searchEngine}
                engine={engine}
                device={device}
              />
            ))}
          </div>
        )}
      </QueryState>
    </section>
  );
}

function EngineBlock({
  engine,
  device,
}: {
  engine: DomainTrackerEngineSummary;
  device: "desktop" | "mobile";
}) {
  const hasSnapshots = engine.trend.length > 0 || engine.summary.total > 0;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <Badge variant="outline">
        {SEARCH_ENGINE_LABELS[engine.searchEngine]}
      </Badge>
      {hasSnapshots ? (
        <>
          <RankVisibilityTiles point={engine.summary} />
          <RankVisibilityChart points={engine.trend} />
          {engine.topPages.length > 0 ? (
            <TopPagesTable pages={engine.topPages} />
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={TrendingUp}
          size="sm"
          title={`No ${device} positions yet`}
          description="Positions appear here once the tracker completes a check on this device."
        />
      )}
    </div>
  );
}

/** Top pages by tracked queries: each keyword's latest position, grouped by
 *  the ranking URL. */
function TopPagesTable({ pages }: { pages: DomainTrackerTopPage[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Top pages</TableHead>
          <TableHead className="text-right">Queries in top</TableHead>
          <TableHead className="text-right">Best position</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.url}>
            <TableCell className="max-w-md truncate font-medium">
              {page.url}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {page.keywords.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              #{page.bestPosition}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
