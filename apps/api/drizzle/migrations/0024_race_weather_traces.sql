CREATE TABLE "race_weather_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" varchar(10) DEFAULT 'race' NOT NULL,
	"minute_offsets" integer[] NOT NULL,
	"air_temp_tenths" integer[] NOT NULL,
	"track_temp_tenths" integer[] NOT NULL,
	"rainfall" boolean[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "race_weather_traces" ADD CONSTRAINT "race_weather_traces_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "race_weather_traces_race_session_idx" ON "race_weather_traces" USING btree ("race_id","session_type");