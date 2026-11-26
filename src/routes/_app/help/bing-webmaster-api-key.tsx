import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { helpLinkClassName } from "@/client/features/help/SecretHelpPage";

const BING_WEBMASTER_URL = "https://www.bing.com/webmasters";

export const Route = createFileRoute("/_app/help/bing-webmaster-api-key")({
  component: BingWebmasterApiKeyHelpPage,
});

function BingWebmasterApiKeyHelpPage() {
  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Connect Bing Webmaster"
          description={
            <>
              OpenSEO reads search queries and external links for your project
              from the Bing Webmaster API. Unlike other integrations, no
              environment secret is needed — the API key belongs to your Bing
              account and is entered in the app.
            </>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Steps</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                Make sure your site is verified in{" "}
                <a
                  className={helpLinkClassName}
                  href={BING_WEBMASTER_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Bing Webmaster Tools
                </a>
                . The API only lists verified sites, so verification happens on
                Bing's side first.
              </li>
              <li>
                In Bing Webmaster Tools, open <code>Settings</code> →{" "}
                <code>API access</code> and generate an API key. Copy it — Bing
                shows it once per session.
              </li>
              <li>
                In OpenSEO, go to <code>Settings</code> →{" "}
                <code>Integrations</code> → <code>Bing Webmaster</code>, paste
                the key, and pick the verified site for this project.
              </li>
              <li>
                Search queries and external links start syncing right away and
                refresh automatically afterwards (cached for up to 12 hours per
                source).
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Notes</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The key is stored encrypted at rest and is never displayed again
              after saving — keep a copy in Bing's API access page if you need
              to reuse it for another project.
            </p>
            <p>
              The same key can serve several OpenSEO projects: each project
              stores its own site selection, not its own key.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
