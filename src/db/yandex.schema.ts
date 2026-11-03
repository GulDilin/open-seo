import { sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// Connected Yandex Webmaster site per project.
// OAuth tokens live in the better-auth `account` table under providerId
// "yandex-webmaster"; this row only records which verified Yandex site maps to
// a project and whose grant to use when calling the Webmaster API.
export const yandexConnections = sqliteTable(
  "yandex_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Yandex Webmaster's opaque site id (e.g. "https:example.com:443"). It
    // cannot be derived from a URL — only listed via /v4/user/{uid}/hosts.
    hostId: text("host_id").notNull(),
    // ascii_host_url as Yandex listed it, for display only.
    hostUrl: text("host_url").notNull(),
    // Whose yandex-webmaster grant API calls should use.
    connectedByUserId: text("connected_by_user_id").notNull(),
    // Yandex Webmaster uid backing the grant at connect time.
    yandexAccountId: text("yandex_account_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    // One Yandex site per project in v1; switching replaces the row.
    uniqueIndex("yandex_connections_project_idx").on(table.projectId),
    index("yandex_connections_organization_idx").on(table.organizationId),
  ],
);
