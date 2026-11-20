CREATE TABLE `webmaster_backlink_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`destination_url` text NOT NULL,
	`discovery_date` text,
	`source_last_access_date` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webmaster_backlink_samples_unique` ON `webmaster_backlink_samples` (`project_id`,`source_url`,`destination_url`);--> statement-breakpoint
CREATE INDEX `webmaster_backlink_samples_discovery_idx` ON `webmaster_backlink_samples` (`project_id`,`discovery_date`);--> statement-breakpoint
CREATE TABLE `webmaster_backlink_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`links_total_count` integer NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webmaster_backlink_snapshots_unique` ON `webmaster_backlink_snapshots` (`project_id`,`source`,`date`);