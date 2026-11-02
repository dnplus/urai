CREATE TABLE `result_tally` (
	`day` text NOT NULL,
	`pattern` text NOT NULL,
	`rarity` text NOT NULL,
	`family` text NOT NULL,
	`client` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `pattern`, `rarity`, `family`, `client`)
);
