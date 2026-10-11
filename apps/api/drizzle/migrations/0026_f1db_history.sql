CREATE TABLE "f1db_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(30) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_constructor_lineage" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_f1db_id" varchar(100) NOT NULL,
	"position" integer NOT NULL,
	"constructor_f1db_id" varchar(100) NOT NULL,
	"year_from" integer NOT NULL,
	"year_to" integer
);
--> statement-breakpoint
CREATE TABLE "history_constructor_seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"constructor_f1db_id" varchar(100) NOT NULL,
	"year" integer NOT NULL,
	"chassis" varchar(200),
	"engine" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "history_constructors" (
	"id" serial PRIMARY KEY NOT NULL,
	"f1db_id" varchar(100) NOT NULL,
	"name" varchar(120) NOT NULL,
	"full_name" varchar(200),
	"country" varchar(60),
	"championships" integer DEFAULT 0 NOT NULL,
	"race_starts" integer DEFAULT 0 NOT NULL,
	"race_wins" integer DEFAULT 0 NOT NULL,
	"podiums" integer DEFAULT 0 NOT NULL,
	"pole_positions" integer DEFAULT 0 NOT NULL,
	"fastest_laps" integer DEFAULT 0 NOT NULL,
	"career_points" numeric(9, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"f1db_id" varchar(100) NOT NULL,
	"match_key" varchar(120) NOT NULL,
	"name" varchar(120) NOT NULL,
	"abbreviation" varchar(3),
	"date_of_birth" date,
	"date_of_death" date,
	"nationality" varchar(60),
	"championships" integer DEFAULT 0 NOT NULL,
	"race_starts" integer DEFAULT 0 NOT NULL,
	"race_wins" integer DEFAULT 0 NOT NULL,
	"podiums" integer DEFAULT 0 NOT NULL,
	"pole_positions" integer DEFAULT 0 NOT NULL,
	"fastest_laps" integer DEFAULT 0 NOT NULL,
	"career_points" numeric(8, 2) DEFAULT '0' NOT NULL,
	"sprint_wins" integer DEFAULT 0 NOT NULL,
	"grand_slams" integer DEFAULT 0 NOT NULL,
	"first_race_date" date,
	"first_race_name" varchar(200),
	"first_win_date" date,
	"first_win_name" varchar(200),
	"first_podium_date" date,
	"first_podium_name" varchar(200),
	"first_pole_date" date,
	"first_pole_name" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "f1db_imports_version_idx" ON "f1db_imports" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "history_constructor_lineage_idx" ON "history_constructor_lineage" USING btree ("parent_f1db_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "history_constructor_seasons_idx" ON "history_constructor_seasons" USING btree ("constructor_f1db_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "history_constructors_f1db_idx" ON "history_constructors" USING btree ("f1db_id");--> statement-breakpoint
CREATE UNIQUE INDEX "history_drivers_f1db_idx" ON "history_drivers" USING btree ("f1db_id");--> statement-breakpoint
CREATE INDEX "history_drivers_match_key_idx" ON "history_drivers" USING btree ("match_key");