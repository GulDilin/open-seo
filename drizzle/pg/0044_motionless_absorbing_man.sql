CREATE TABLE "index_status_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"engine" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"evidence" text NOT NULL,
	"checked_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_status_page_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_status_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_status_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"collector" text NOT NULL,
	"collected_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "index_status_checks" ADD CONSTRAINT "index_status_checks_page_id_index_status_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."index_status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_status_page_sources" ADD CONSTRAINT "index_status_page_sources_page_id_index_status_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."index_status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_status_pages" ADD CONSTRAINT "index_status_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_status_runs" ADD CONSTRAINT "index_status_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "index_status_checks_unique" ON "index_status_checks" USING btree ("page_id","engine");--> statement-breakpoint
CREATE UNIQUE INDEX "index_status_page_sources_unique" ON "index_status_page_sources" USING btree ("page_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "index_status_pages_url_unique" ON "index_status_pages" USING btree ("project_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "index_status_runs_unique" ON "index_status_runs" USING btree ("project_id","collector");