CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`question_count` integer NOT NULL,
	`types_json` text NOT NULL,
	`salt` text NOT NULL,
	`hashes_json` text NOT NULL,
	`results_json` text,
	`used_at` text,
	`created_at` text NOT NULL
);
