CREATE TABLE "title_odds_drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"after_round" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"title_probability" numeric(6, 5) NOT NULL,
	"expected_points" numeric(6, 1) NOT NULL,
	"points_p10" numeric(6, 1) NOT NULL,
	"points_p90" numeric(6, 1) NOT NULL,
	"simulations" integer NOT NULL,
	"model_version" varchar(30) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title_odds_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"after_round" integer NOT NULL,
	"team_id" integer NOT NULL,
	"title_probability" numeric(6, 5) NOT NULL,
	"expected_points" numeric(6, 1) NOT NULL,
	"points_p10" numeric(6, 1) NOT NULL,
	"points_p90" numeric(6, 1) NOT NULL,
	"simulations" integer NOT NULL,
	"model_version" varchar(30) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "title_odds_drivers" ADD CONSTRAINT "title_odds_drivers_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_odds_drivers" ADD CONSTRAINT "title_odds_drivers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_odds_teams" ADD CONSTRAINT "title_odds_teams_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_odds_teams" ADD CONSTRAINT "title_odds_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "title_odds_drivers_season_round_driver_idx" ON "title_odds_drivers" USING btree ("season_id","after_round","driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "title_odds_teams_season_round_team_idx" ON "title_odds_teams" USING btree ("season_id","after_round","team_id");