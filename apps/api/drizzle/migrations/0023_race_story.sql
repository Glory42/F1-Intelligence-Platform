CREATE TABLE "race_battles" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" varchar(10) DEFAULT 'race' NOT NULL,
	"chaser_driver_id" integer NOT NULL,
	"leader_driver_id" integer NOT NULL,
	"lap_start" integer NOT NULL,
	"lap_end" integer NOT NULL,
	"min_gap_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_lap_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" varchar(10) DEFAULT 'race' NOT NULL,
	"driver_id" integer NOT NULL,
	"positions" integer[] NOT NULL,
	"gaps_ms" integer[] NOT NULL,
	"intervals_ms" integer[] NOT NULL,
	"laps_down" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "race_battles" ADD CONSTRAINT "race_battles_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_battles" ADD CONSTRAINT "race_battles_chaser_driver_id_drivers_id_fk" FOREIGN KEY ("chaser_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_battles" ADD CONSTRAINT "race_battles_leader_driver_id_drivers_id_fk" FOREIGN KEY ("leader_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_lap_traces" ADD CONSTRAINT "race_lap_traces_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_lap_traces" ADD CONSTRAINT "race_lap_traces_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "race_battles_race_session_chaser_lap_idx" ON "race_battles" USING btree ("race_id","session_type","chaser_driver_id","lap_start");--> statement-breakpoint
CREATE UNIQUE INDEX "race_lap_traces_race_session_driver_idx" ON "race_lap_traces" USING btree ("race_id","session_type","driver_id");