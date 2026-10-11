DROP INDEX "drivers_season_number_idx";--> statement-breakpoint
CREATE INDEX "drivers_season_number_idx" ON "drivers" USING btree ("season_id","driver_number");