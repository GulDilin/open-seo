/**
 * Broken external link check.
 *
 * The crawl records each page's outgoing cross-origin link targets in the
 * audit scratchpad (they are never crawled themselves); at finalize this
 * module fetches a bounded sample of those targets and reports the ones
 * that answer with an error status or cannot be reached at all.
 */
import { isCrawlableUrl } from "@/server/lib/audit/url-policy";
import type { PageLink } from "@/server/lib/audit/types";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";

interface ExternalLinkEdge {
  sourcePageId: string;
  sourceUrl: string;
  targetUrl: string;
}

/** First N unique external URLs recorded per page (analyzer already deduped). */
const MAX_EXTERNAL_LINKS_PER_PAGE = 25;
/** Unique external URLs probed per audit; the rest are left unchecked. */
export const MAX_CHECKED_EXTERNAL_LINKS = 200;
const CHECK_CONCURRENCY = 10;
const CHECK_TIMEOUT_MS = 10_000;

const PROBE_HEADERS = {
  "User-Agent": "OpenSEO-Audit/1.0",
  Accept: "text/html,application/xhtml+xml,*/*",
} as const;

/**
 * The external targets one crawled page contributes to the check. The page
 * analyzer only emits http(s) targets, so this filters for the SSRF policy
 * only: isCrawlableUrl blocks non-http(s) schemes, private/loopback IP
 * literals and internal hostnames — the same screen the crawl frontier
 * applies. First-come order caps the stored set per page.
 */
export function externalLinkTargets(
  links: PageLink[],
  cap = MAX_EXTERNAL_LINKS_PER_PAGE,
): string[] {
  const targets: string[] = [];
  for (const link of links) {
    if (link.isInternal) continue;
    if (targets.length >= cap) break;
    if (isCrawlableUrl(link.targetUrl)) targets.push(link.targetUrl);
  }
  return targets;
}

/**
 * Probe every recorded external target once and map failures onto the edges
 * that reference them. Redirects (3xx) count as working links: the target
 * answers, it just lives elsewhere now. A network error or timeout counts
 * as unreachable — for a user the link is as dead as a 404.
 */
export async function runExternalLinkChecks(
  edges: ExternalLinkEdge[],
): Promise<DetectedIssue[]> {
  const targets = Array.from(new Set(edges.map((edge) => edge.targetUrl)))
    .filter(isCrawlableUrl)
    .slice(0, MAX_CHECKED_EXTERNAL_LINKS);

  const outcomes = new Map<string, number | "unreachable">();
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < targets.length; index = next++) {
      const target = targets[index];
      outcomes.set(target, await probe(target));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CHECK_CONCURRENCY, targets.length) }, worker),
  );

  const issues: DetectedIssue[] = [];
  for (const edge of edges) {
    const outcome = outcomes.get(edge.targetUrl);
    // Unprobed targets (past the audit cap) and working answers are skipped.
    if (outcome == null) continue;
    if (outcome !== "unreachable" && outcome < 400) continue;
    issues.push({
      issueType: "broken-external-link",
      pageId: edge.sourcePageId,
      pageUrl: edge.sourceUrl,
      dedupeKey: edge.targetUrl,
      details: {
        targetUrl: edge.targetUrl,
        targetStatus: outcome === "unreachable" ? "unreachable" : outcome,
      },
    });
  }
  return issues;
}

/** GET, not HEAD: plenty of servers reject HEAD with a 403/405 that would
 * masquerade as a broken link. Manual redirects keep the SSRF policy honest
 * (a redirect cannot steer this fetch at an address the policy would block),
 * and the body is dropped — only the status line matters. */
async function probe(target: string): Promise<number | "unreachable"> {
  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "manual",
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return "unreachable";
  }
}
