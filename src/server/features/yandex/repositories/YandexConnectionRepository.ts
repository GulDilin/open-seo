import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { yandexConnections } from "@/db/schema";

type YandexConnection = typeof yandexConnections.$inferSelect;

async function getByProjectId(
  projectId: string,
): Promise<YandexConnection | null> {
  const rows = await db
    .select()
    .from(yandexConnections)
    .where(eq(yandexConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsert(input: {
  projectId: string;
  organizationId: string;
  hostId: string;
  hostUrl: string;
  connectedByUserId: string;
  yandexAccountId: string;
}): Promise<YandexConnection> {
  const [row] = await db
    .insert(yandexConnections)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: yandexConnections.projectId,
      set: {
        hostId: input.hostId,
        hostUrl: input.hostUrl,
        organizationId: input.organizationId,
        connectedByUserId: input.connectedByUserId,
        yandexAccountId: input.yandexAccountId,
        updatedAt: sql`(current_timestamp)`,
      },
    })
    .returning();
  if (!row) {
    throw new Error("Failed to upsert yandex_connection");
  }
  return row;
}

async function deleteByProjectId(projectId: string): Promise<void> {
  await db
    .delete(yandexConnections)
    .where(eq(yandexConnections.projectId, projectId));
}

export const YandexConnectionRepository = {
  getByProjectId,
  upsert,
  deleteByProjectId,
};
