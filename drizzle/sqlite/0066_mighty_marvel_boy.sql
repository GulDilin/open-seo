CREATE TABLE `index_status_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`engine` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`evidence` text NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `index_status_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_status_checks_unique` ON `index_status_checks` (`page_id`,`engine`);--> statement-breakpoint
CREATE TABLE `index_status_page_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `index_status_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_status_page_sources_unique` ON `index_status_page_sources` (`page_id`,`source`);--> statement-breakpoint
CREATE TABLE `index_status_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_status_pages_url_unique` ON `index_status_pages` (`project_id`,`url`);--> statement-breakpoint
CREATE TABLE `index_status_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`collector` text NOT NULL,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_status_runs_unique` ON `index_status_runs` (`project_id`,`collector`);