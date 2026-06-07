ALTER TABLE `shows` DROP COLUMN `remove_promos`;
--> statement-breakpoint
UPDATE `ads` SET `label` = 'ad' WHERE `label` = 'promo';