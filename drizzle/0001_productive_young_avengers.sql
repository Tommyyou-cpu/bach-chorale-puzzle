PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`genre` text NOT NULL,
	`voice_count` integer NOT NULL,
	`clefs` text NOT NULL,
	`key_signature` text NOT NULL,
	`bwv` text NOT NULL,
	`measures` text NOT NULL,
	`duration` real NOT NULL,
	`bpm` integer NOT NULL,
	`source` text NOT NULL,
	`source_label` text NOT NULL,
	`analysis` text NOT NULL,
	`license_note` text NOT NULL,
	`voices` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "questions_voice_count_check" CHECK("voice_count" in (3, 4)),
	CONSTRAINT "questions_clefs_json_check" CHECK(json_valid("clefs")),
	CONSTRAINT "questions_voices_json_check" CHECK(json_valid("voices"))
);
--> statement-breakpoint
INSERT INTO `__new_questions`("id", "title", "genre", "voice_count", "clefs", "key_signature", "bwv", "measures", "duration", "bpm", "source", "source_label", "analysis", "license_note", "voices", "enabled", "sort_order", "created_at", "updated_at") SELECT "id", "title", "genre", "voice_count", "clefs", "key_signature", "bwv", "measures", "duration", "bpm", "source", "source_label", "analysis", "license_note", "voices", "enabled", "sort_order", "created_at", "updated_at" FROM `questions`;--> statement-breakpoint
DROP TABLE `questions`;--> statement-breakpoint
ALTER TABLE `__new_questions` RENAME TO `questions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
