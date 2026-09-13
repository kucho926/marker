CREATE TABLE `answer_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`previous_answer` text NOT NULL,
	`new_answer` text NOT NULL,
	`is_correct` integer NOT NULL,
	`changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `assignments` ADD `owner_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `current_answers_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `attempt_count` integer DEFAULT 0 NOT NULL;