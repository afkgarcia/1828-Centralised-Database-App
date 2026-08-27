CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
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
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasks_list_xor" CHECK(("__new_tasks"."city_id" IS NULL) <> ("__new_tasks"."phase_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "city_id", "phase_id", "position", "step", "blok", "deliverable", "r", "a", "s", "c", "i_col", "opm", "link_hint", "status", "is_custom") SELECT "id", "city_id", "phase_id", "position", "step", "blok", "deliverable", "r", "a", "s", "c", "i_col", "opm", "link_hint", "status", "is_custom" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_city` ON `tasks` (`city_id`);--> statement-breakpoint
CREATE INDEX `tasks_phase` ON `tasks` (`phase_id`);