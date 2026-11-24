import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { IndexStatusService } from "@/server/features/index-status/services/IndexStatusService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  DEFAULT_INDEX_STATUS_PAGE_SIZE,
  INDEX_STATUS_PAGE_SIZES,
} from "@/types/schemas/index-status";

const indexStatusInputSchema = z.object({
  projectId: z.string().min(1),
  problemsOnly: z.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce
    .number()
    .int()
    .refine((value) =>
      (INDEX_STATUS_PAGE_SIZES as readonly number[]).includes(value),
    )
    .optional(),
  // Skip the collect TTL and re-pull from connected engines now.
  force: z.boolean().optional(),
});

/** The Index Status page payload, served from storage so it answers in
 *  milliseconds. `force` is the slow path: it re-pulls audit, Google and Yandex
 *  data synchronously for the Refresh button and the client's background
 *  refresh of a stale payload. GSC URL inspections are quota-capped and
 *  cached, so a render never re-inspects. */
export const getIndexStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexStatusInputSchema)
  .handler(async ({ data, context }) =>
    IndexStatusService.getIndexStatus({
      projectId: context.projectId,
      problemsOnly: data.problemsOnly ?? false,
      page: data.page ?? 1,
      pageSize: data.size ?? DEFAULT_INDEX_STATUS_PAGE_SIZE,
      force: data.force ?? false,
    }),
  );
