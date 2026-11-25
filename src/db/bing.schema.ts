import { sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// Connected Bing Webmaster site per project.
// Bing authenticates with a static API key the user generates in Bing Webmaster
// Tools (Settings → API access) — there is no OAuth flow for it. The key
// belongs to the Bing account, not the project, so it is stored here next to
// the chosen site (the connect card asks for both together) and encrypted at
// rest like the OAuth grants. Several projects may share one key.
export const bingConnections = sqliteTable(
  "bing_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Verbatim from GetUserSites' Url (e.g. "http://example.com/"). Bing
    // matches siteUrl byte-for-byte, so it is never normalized.
    siteUrl: text("site_url").notNull(),
    // The user's Bing Webmaster API key, encrypted at rest.
    apiKey: text("api_key").notNull(),
    // Whose account the key was entered under (display/audit only — the key
    // itself is what authorizes API calls).
    connectedByUserId: text("connected_by_user_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    // One Bing site per project in v1; switching replaces the row.
    uniqueIndex("bing_connections_project_idx").on(table.projectId),
    index("bing_connections_organization_idx").on(table.organizationId),
  ],
);
