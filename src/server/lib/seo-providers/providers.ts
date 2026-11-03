import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  SEO_PROVIDER_CREDENTIALS,
  SEO_PROVIDER_IDS,
  type ProviderId,
} from "@/shared/search-engines";

/**
 * Credential-presence registry for the SEO provider fleet. Presence-only in
 * this phase: no HTTP, no secrets in memory beyond the env accessor itself.
 * Preflight (which is synchronous over an env record) and the async server
 * path read the same credential table, so the two can never drift.
 */

export async function getSeoProviderStatuses(): Promise<
  Record<ProviderId, boolean>
> {
  const names = [
    ...new Set(SEO_PROVIDER_IDS.flatMap((id) => SEO_PROVIDER_CREDENTIALS[id])),
  ];
  const present = new Set(
    (
      await Promise.all(
        names.map(async (name) =>
          (await getOptionalEnvValue(name)) ? name : null,
        ),
      )
    ).filter((name): name is string => name !== null),
  );
  const statuses: Record<ProviderId, boolean> = {
    serper: false,
    yandex: false,
    brightdata: false,
    googleads: false,
    dataforseo: false,
  };
  for (const id of SEO_PROVIDER_IDS) {
    statuses[id] = SEO_PROVIDER_CREDENTIALS[id].every((name) =>
      present.has(name),
    );
  }
  return statuses;
}
