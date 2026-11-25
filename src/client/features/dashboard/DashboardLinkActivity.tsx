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
import {
  DataForSeoRequiredBadge,
  useSeoProviderSetup,
} from "@/client/components/ProviderRequiredBadge";
import { DashboardInfo, ExternalPage, Freshness } from "./siteTabParts";
import { moreDetailsClass } from "./cardParts";

// DataForSEO rows keep their own shape (referring domains, or backlinks with
// anchors); Yandex reports only source page → target page and a date, so it
// renders as its own section. Captions appear only when both sources have rows.
function SourceCaption({ label }: { label: string }) {
  return (
    <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
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
    // would throw server-side on every dashboard visit. The badge below
    // explains instead of showing a load error.
    enabled: setup.data?.dataforseo === true,
  });
  if (setup.data && !setup.data.dataforseo) {
    return (
      <CardShell title="New backlinks">
        <DataForSeoRequiredBadge />
      </CardShell>
    );
  }
  return (
    <QueryState query={query} errorFallback="Could not load new links">
      {(data) => {
        const hasDfsRows = data.value.length > 0 || data.links.length > 0;
        const hasYandexRows = data.yandex.length > 0;
        return (
          <CardShell
            title="New backlinks"
            titleInfo={
              <DashboardInfo label="About new links">
                <p>
                  Links to your website found in the past week. We show new
                  linking sites first.
                </p>
                <p className="mt-2">
                  A link may be older than the date it was found.
                </p>
                <p className="mt-2">
                  Links come from DataForSEO and, when Yandex Webmaster is
                  connected, from Yandex too — each section is labelled.
                </p>
              </DashboardInfo>
            }
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
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Referring page</TableHead>
                          <TableHead>Target page</TableHead>
                          <TableHead className="text-right">Found</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.yandex.slice(0, 5).map((row, index) => (
                          <TableRow key={`${row.urlFrom}:${index}`}>
                            <TableCell>
                              <ExternalPage
                                url={row.urlFrom}
                                label={row.domainFrom}
                              />
                            </TableCell>
                            <TableCell>
                              <ExternalPage url={row.urlTo} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.firstSeen?.slice(0, 10) ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </section>
                ) : null}
              </div>
            ) : (
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
            )}
          </CardShell>
        );
      }}
    </QueryState>
  );
}
