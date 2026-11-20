import { z } from "zod";

export const DEFAULT_INDEX_STATUS_PAGE_SIZE = 25;
export const INDEX_STATUS_PAGE_SIZES = [10, 25, 50, 100] as const;

export const indexStatusSearchSchema = z.object({
  problemsOnly: z.boolean().optional().catch(undefined),
  page: z.coerce.number().int().positive().optional().catch(undefined),
  size: z.coerce
    .number()
    .int()
    .refine((value) =>
      (INDEX_STATUS_PAGE_SIZES as readonly number[]).includes(value),
    )
    .optional()
    .catch(undefined),
});
