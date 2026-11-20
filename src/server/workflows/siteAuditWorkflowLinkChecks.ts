/**
 * The site-audit workflow's link-check pieces: the standalone external-link
 * probe step (run after the crawl) and the scratchpad link-graph mapping
 * used by the finalize step. Both read the audit's scratchpad Durable
 * Object, where link edges live — never the app DB.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { normalizeUrl } from "@/server/lib/audit/url-utils";
import { runExternalLinkChecks } from "@/server/lib/audit/issues/external-links";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { getAuditScratchpad } from "@/server/features/audit/AuditScratchpad";
import { pgStep } from "@/server/workflows/pgStep";
import { EXTERNAL_LINKS_STEP } from "@/server/workflows/auditStepConfigs";
import type { CrawlPhaseResult } from "@/server/workflows/siteAuditWorkflowCrawl";

/**
 * Probe the crawl's recorded external link targets (up to the checker's
 * caps) and persist broken-external-link issues. Its own step, apart from
 * the finalize link checks: a step retry re-issues only these free outbound
 * probes, and the issue rows are idempotent via deterministic ids.
 */
export async function runExternalLinksPhase(
  step: WorkflowStep,
  auditId: string,
) {
  await pgStep(step, "external-link-checks", EXTERNAL_LINKS_STEP, async () => {
    const edges = await getAuditScratchpad(auditId).getExternalLinks();
    const issues = await runExternalLinkChecks(edges);
    if (issues.length > 0) {
      await AuditRepository.insertIssues(auditId, issues);
    }
    return { issueCount: issues.length };
  });
}

/**
 * The two finalize checks that need link edges run as SQL inside the
 * audit's scratchpad DO; map their rows onto DetectedIssue.
 */
export async function runScratchpadLinkChecks(
  auditId: string,
  startUrl: string,
  crawl: CrawlPhaseResult,
): Promise<DetectedIssue[]> {
  const scratchpad = getAuditScratchpad(auditId);
  const { brokenLinks, orphanPages } = await scratchpad.runFinalizeChecks({
    // Page rows store normalized URLs; normalize the start URL the same way
    // so the orphan exclusion matches.
    startUrl: normalizeUrl(startUrl) ?? startUrl,
    // Orphan detection only makes sense when the crawl wasn't truncated.
    crawlCompleted: crawl.completed,
  });

  return [
    ...brokenLinks.map((row) => ({
      issueType: "broken-internal-link" as const,
      pageId: row.sourcePageId,
      pageUrl: row.sourceUrl,
      dedupeKey: row.targetUrl,
      // Status 0 is the crawl's network-failure marker (timeout/DNS): show
      // the reason, not a bare zero.
      details: {
        targetUrl: row.targetUrl,
        targetStatus: row.targetStatus === 0 ? "unreachable" : row.targetStatus,
      },
    })),
    ...orphanPages.map((row) => ({
      issueType: "orphan-page" as const,
      pageId: row.pageId,
      pageUrl: row.url,
    })),
  ];
}
