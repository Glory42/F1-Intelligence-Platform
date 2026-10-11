CREATE TABLE "qualifying_lap_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" varchar(4) NOT NULL,
	"driver_id" integer NOT NULL,
	"lap_number" integer NOT NULL,
	"lap_time_ms" integer NOT NULL,
	"samples" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qualifying_lap_telemetry" ADD CONSTRAINT "qualifying_lap_telemetry_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_lap_telemetry" ADD CONSTRAINT "qualifying_lap_telemetry_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qualifying_lap_telemetry_race_session_driver_idx" ON "qualifying_lap_telemetry" USING btree ("race_id","session_type","driver_id");