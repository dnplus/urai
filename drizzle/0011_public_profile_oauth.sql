CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`secret_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`card_id` text NOT NULL,
	`scope` text NOT NULL,
	`manage_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`code_hash` text,
	`code_challenge` text,
	`code_redirect_uri` text,
	`code_expires_at` integer,
	`access_hash` text,
	`access_expires_at` integer,
	`refresh_hash` text,
	`previous_refresh_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_client_card` ON `oauth_grants` (`client_id`,`card_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_card` ON `oauth_grants` (`card_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_code` ON `oauth_grants` (`code_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grants_access` ON `oauth_grants` (`access_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grants_refresh` ON `oauth_grants` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grants_manage` ON `oauth_grants` (`manage_hash`);--> statement-breakpoint
ALTER TABLE `public_cards` ADD `profile` text;