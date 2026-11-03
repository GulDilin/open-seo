/** Domain matching shared by the SERP provider clients and adapters. */

/** Strip a leading "www." so hostnames compare like DataForSEO domains. */
export function hostOf(link: string): string {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/**
 * Organic-only matching, subdomains count — same rule as the incumbent's
 * buildRankCheckResult, so cross-provider history stays comparable. The
 * target must already be lowercase.
 */
export function matchesTargetDomain(domain: string, target: string): boolean {
  return domain !== "" && (domain === target || domain.endsWith(`.${target}`));
}
