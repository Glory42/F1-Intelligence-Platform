CREATE TABLE "pre_quali_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"features" jsonb NOT NULL,
	"raw_weighted_score" numeric(8, 6) NOT NULL,
	"win_probability" numeric(6, 5) NOT NULL,
	"predicted_position" integer,
	"model_version" varchar(20) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pre_quali_predictions" ADD CONSTRAINT "pre_quali_predictions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_quali_predictions" ADD CONSTRAINT "pre_quali_predictions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_quali_predictions_race_driver_idx" ON "pre_quali_predictions" USING btree ("race_id","driver_id");