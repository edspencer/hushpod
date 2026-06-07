ALTER TABLE `shows` ADD `remove_fluff` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `ads` SET `label` = 'fluff' WHERE `label` IN ('intro', 'outro');