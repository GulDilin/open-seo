CREATE TABLE `yandex_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`host_id` text NOT NULL,
	`host_url` text NOT NULL,
	`connected_by_user_id` text NOT NULL,
	`yandex_account_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yandex_connections_project_idx` ON `yandex_connections` (`project_id`);--> statement-breakpoint
CREATE INDEX `yandex_connections_organization_idx` ON `yandex_connections` (`organization_id`);