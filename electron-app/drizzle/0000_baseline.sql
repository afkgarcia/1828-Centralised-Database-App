CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`added_by_user_id` text,
	`added_by_label` text NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `cities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`submitted` integer DEFAULT false NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cities_name_unique` ON `cities` (`name`);--> statement-breakpoint
CREATE TABLE `email_recipients` (
	`email_id` text NOT NULL,
	`recipient` text NOT NULL,
	PRIMARY KEY(`email_id`, `recipient`),
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`from_email` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`delivered_via` text DEFAULT 'outbox' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `password_reset_codes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `phase_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`idx` integer NOT NULL,
	`sheet` text NOT NULL,
	`is_city_phase` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phase_templates_idx_unique` ON `phase_templates` (`idx`);--> statement-breakpoint
CREATE TABLE `phases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`idx` integer NOT NULL,
	`sheet` text NOT NULL,
	`submitted` integer DEFAULT false NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phases_project_idx` ON `phases` (`project_id`,`idx`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_template_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_row` integer NOT NULL,
	`step` text NOT NULL,
	`blok` text NOT NULL,
	`deliverable` text NOT NULL,
	`link_hint` text DEFAULT '' NOT NULL,
	`r` text DEFAULT '' NOT NULL,
	`a` text DEFAULT '' NOT NULL,
	`s` text DEFAULT '' NOT NULL,
	`c` text DEFAULT '' NOT NULL,
	`i_col` text DEFAULT '' NOT NULL,
	`opm` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`phase_template_id`) REFERENCES `phase_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_templates_phase` ON `task_templates` (`phase_template_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text,
	`phase_id` text,
	`position` integer NOT NULL,
	`step` text NOT NULL,
	`blok` text NOT NULL,
	`deliverable` text NOT NULL,
	`r` text DEFAULT '' NOT NULL,
	`a` text DEFAULT '' NOT NULL,
	`s` text DEFAULT '' NOT NULL,
	`c` text DEFAULT '' NOT NULL,
	`i_col` text DEFAULT '' NOT NULL,
	`opm` text DEFAULT '' NOT NULL,
	`link_hint` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`is_custom` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_city` ON `tasks` (`city_id`);--> statement-breakpoint
CREATE INDEX `tasks_phase` ON `tasks` (`phase_id`);--> statement-breakpoint
CREATE TABLE `user_city_access` (
	`user_id` text NOT NULL,
	`city_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `city_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_project_access` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`access_all_cities` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);