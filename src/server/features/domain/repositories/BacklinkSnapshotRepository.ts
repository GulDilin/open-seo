import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { backlinkSnapshots } from "@/db/schema";

type BacklinkSnapshot = typeof backlinkSnapshots.$inferSelect;

async function getLatestForProject(
  projectId: string,
): Promise<BacklinkSnapshot | null> {
  const rows = await db
    .select()
    .from(backlinkSnapshots)
    .where(eq(backlinkSnapshots.projectId, projectId))
    // id, not capturedAt: autoincrement is monotonic and immune to the
    // sqlite-vs-pg timestamp text-format difference.
    .orderBy(desc(backlinkSnapshots.id))
    .limit(1);
  return rows[0] ?? null;
}

export const BacklinkSnapshotRepository = {
  getLatestForProject,
};
