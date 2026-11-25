import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/client/components/ui/table";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { CardShell } from "@/client/components/CardShell";
import { QueryState } from "@/client/components/QueryState";
import { getDashboardLinkActivity } from "@/serverFunctions/dashboard";
import { useSeoProviderSetup } from "@/client/components/ProviderRequiredBadge";
import {
  DashboardInfo,
  ExternalPage,
  Freshness,
  useWebmasterLinksQuery,
  WebmasterLinksUnavailable,
  YandexLinksTable,
  YandexSourceNote,
} from "./siteTabParts";
import { moreDetailsClass } from "./cardParts";

// DataForSEO rows keep their own shape (referring domains, or backlinks with
// anchors); Yandex reports only source page → target page and a date, so it
// renders as its own section. Captions appear only when both sources have rows.
function SourceCaption({ label }: { label: string }) {
  return (
    <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
  );
}

function NewLinksEmptyState({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
      <Link2 className="size-7 text-muted-foreground" />
      <h3 className="font-medium">No new links this week</h3>
      <p className="text-sm text-muted-foreground">
        Explore the sites already linking to you.
      </p>
      <Link
        to="/p/$projectId"
        params={{ projectId }}
        search={{ tab: "backlinks" }}
        className="text-sm text-primary hover:underline"
      >
        View backlinks →
      </Link>
    </div>
  );
}

function NewLinksInfo() {
  return (
    <DashboardInfo label="About new links">
      <p>
        Links to your website found in the past week. We show new linking sites
        first.
      </p>
      <p className="mt-2">A link may be older than the date it was found.</p>
      <p className="mt-2">
        Links come from DataForSEO and, when Yandex Webmaster is connected, from
        Yandex too — each section is labelled.
      </p>
    </DashboardInfo>
  );
}

export function DashboardLinkActivity({
  projectId,
  domain,
}: {
  projectId: string;
  domain: string;
}) {
  const setup = useSeoProviderSetup();
  const query = useQuery({
    queryKey: ["dashboardLinkActivity", projectId, domain],
    queryFn: () => getDashboardLinkActivity({ data: { projectId } }),
    staleTime: 86400_000,
    retry: false,
    // Link activity still runs on DataForSEO; without its key the request
    // would throw server-side on every dashboard visit. Yandex's samples take
    // over instead (see WebmasterLinkActivity).
    enabled: setup.data?.dataforseo === true,
  });
  // No DataForSEO key: connected Yandex Webmaster samples become the card
  // instead of a badge. The badge only returns when Yandex is unavailable too.
  if (setup.data && !setup.data.dataforseo)
    return <WebmasterLinkActivity projectId={projectId} />;
  return (
    <QueryState query={query} errorFallback="Could not load new links">
      {(data) => {
        const hasDfsRows = data.value.length > 0 || data.links.length > 0;
        const hasYandexRows = data.yandex.length > 0;
        return (
          <CardShell
            title="New backlinks"
            titleInfo={<NewLinksInfo />}
            action={
              <Link
                to="/p/$projectId"
                params={{ projectId }}
                search={{ tab: "backlinks" }}
                className={moreDetailsClass}
              >
                View all →
              </Link>
            }
          >
            <Freshness {...data} />
            {hasDfsRows || hasYandexRows ? (
              <div className="flex flex-col gap-4">
                {data.value.length ? (
                  <section>
                    {hasYandexRows ? (
                      <SourceCaption label="DataForSEO" />
                    ) : null}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Referring domain</TableHead>
                          <TableHead className="text-right">
                            Backlinks
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.value.slice(0, 5).map((row, index) => (
                          <TableRow key={row.domain ?? index}>
                            <TableCell className="font-medium">
                              <ExternalPage
                                url={
                                  row.domain ? `https://${row.domain}` : null
                                }
                                label={row.domain}
                              />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.backlinks?.toLocaleString() ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </section>
                ) : data.links.length ? (
                  <section>
                    {hasYandexRows ? (
                      <SourceCaption label="DataForSEO" />
                    ) : null}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Referring page</TableHead>
                          <TableHead>Anchor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.links.slice(0, 5).map((row, index) => (
                          <TableRow key={`${row.urlFrom}:${index}`}>
                            <TableCell>
                              <ExternalPage
                                url={row.urlFrom}
                                label={row.domainFrom}
                              />
                            </TableCell>
                            <TableCell
                              className="max-w-48 truncate"
                              title={row.anchor ?? undefined}
                            >
                              {row.anchor || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </section>
                ) : null}
                {hasYandexRows ? (
                  <section>
                    {hasDfsRows ? (
                      <SourceCaption label="Yandex Webmaster" />
                    ) : null}
                    <YandexLinksTable rows={data.yandex.slice(0, 5)} />
                  </section>
                ) : null}
              </div>
            ) : (
              <NewLinksEmptyState projectId={projectId} />
            )}
          </CardShell>
        );
      }}
    </QueryState>
  );
}

// The no-DataForSEO card: what connected Yandex Webmaster found in the past
// 30 days, newest first. Without a Yandex connection (or with a dead grant)
// the DataForSEO badge comes back — nothing else can fill in.
function WebmasterLinkActivity({ projectId }: { projectId: string }) {
  const query = useWebmasterLinksQuery(projectId);
  return (
    <CardShell
      title="New backlinks"
      action={
        <Link
          to="/p/$projectId"
          params={{ projectId }}
          search={{ tab: "backlinks" }}
          className={moreDetailsClass}
        >
          View all →
        </Link>
      }
    >
      <QueryState query={query} errorFallback="Could not load new links">
        {(data) =>
          data.connected ? (
            <>
              <YandexSourceNote collectError={data.collectError} />
              {data.yandex.length ? (
                <YandexLinksTable rows={data.yandex.slice(0, 5)} />
              ) : (
                <NewLinksEmptyState projectId={projectId} />
              )}
            </>
          ) : (
            <WebmasterLinksUnavailable
              unavailableReason={data.unavailableReason}
            />
          )
        }
      </QueryState>
    </CardShell>
  );
}
