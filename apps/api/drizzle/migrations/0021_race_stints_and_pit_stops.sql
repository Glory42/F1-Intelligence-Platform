CREATE TABLE "race_stints" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" varchar(10) DEFAULT 'race' NOT NULL,
	"driver_id" integer NOT NULL,
	"stint_number" integer NOT NULL,
	"compound" varchar(20),
	"lap_start" integer,
	"lap_end" integer,
	"tyre_age_at_start" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_pit_stops" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" varchar(10) DEFAULT 'race' NOT NULL,
	"driver_id" integer NOT NULL,
	"lap_number" integer NOT NULL,
	"pit_lane_ms" integer,
	"stationary_ms" integer,
	"date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "race_stints" ADD CONSTRAINT "race_stints_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_stints" ADD CONSTRAINT "race_stints_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_pit_stops" ADD CONSTRAINT "race_pit_stops_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_pit_stops" ADD CONSTRAINT "race_pit_stops_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "race_stints_race_session_driver_stint_idx" ON "race_stints" USING btree ("race_id","session_type","driver_id","stint_number");--> statement-breakpoint
CREATE UNIQUE INDEX "race_pit_stops_race_session_driver_lap_idx" ON "race_pit_stops" USING btree ("race_id","session_type","driver_id","lap_number");--> statement-breakpoint
CREATE INDEX "race_pit_stops_driver_idx" ON "race_pit_stops" USING btree ("driver_id");