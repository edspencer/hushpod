CREATE TABLE `ads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`episode_id` integer NOT NULL,
	`show_id` integer NOT NULL,
	`start_time` real NOT NULL,
	`end_time` real NOT NULL,
	`label` text DEFAULT 'ad' NOT NULL,
	`company` text,
	`ad_text` text,
	`reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`guid` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`published_at` integer,
	`source_url` text NOT NULL,
	`duration` real,
	`original_path` text,
	`clean_path` text,
	`original_size` integer,
	`clean_size` integer,
	`transcript` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_show_id_guid_unique` ON `episodes` (`show_id`,`guid`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`feed_url` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`image_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`episode_limit` integer DEFAULT 10 NOT NULL,
	`remove_ads` integer DEFAULT true NOT NULL,
	`remove_promos` integer DEFAULT true NOT NULL,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_feed_url_unique` ON `shows` (`feed_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `shows_slug_unique` ON `shows` (`slug`);