CREATE TABLE `app_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `app_sessions_user_id_idx` ON `app_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `app_sessions_expires_at_idx` ON `app_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`pin_salt` text NOT NULL,
	`pin_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_normalized_name_unique` ON `app_users` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `assignment_progress` (
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`current_answers_json` text DEFAULT '[]' NOT NULL,
	`results_json` text DEFAULT '[]' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_progress_assignment_user_unique` ON `assignment_progress` (`assignment_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `assignment_progress_user_id_idx` ON `assignment_progress` (`user_id`);--> statement-breakpoint
ALTER TABLE `answer_changes` ADD `user_id` text REFERENCES app_users(id);--> statement-breakpoint
CREATE INDEX `answer_changes_assignment_user_idx` ON `answer_changes` (`assignment_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `assignments` ADD `answer_keys_json` text;--> statement-breakpoint
ALTER TABLE `assignments` ADD `is_active` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `updated_at` text;