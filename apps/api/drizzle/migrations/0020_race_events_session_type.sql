ALTER TABLE "race_control_messages" ADD COLUMN "session_type" varchar(10) DEFAULT 'race' NOT NULL;--> statement-breakpoint
ALTER TABLE "race_overtakes" ADD COLUMN "session_type" varchar(10) DEFAULT 'race' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_radio_clips" ADD COLUMN "session_type" varchar(10) DEFAULT 'race' NOT NULL;--> statement-breakpoint
-- Backfill: on a sprint weekend the sprint runs ~a day before the GP, so anything stamped more than
-- 12h before the GP start belongs to the sprint session.
UPDATE "race_control_messages" t SET "session_type" = 'sprint' FROM "races" r WHERE t."race_id" = r."id" AND r."sprint_date" IS NOT NULL AND t."date" < COALESCE(r."race_date_utc" - interval '12 hours', r."race_date"::timestamptz);--> statement-breakpoint
UPDATE "race_overtakes" t SET "session_type" = 'sprint' FROM "races" r WHERE t."race_id" = r."id" AND r."sprint_date" IS NOT NULL AND t."date" < COALESCE(r."race_date_utc" - interval '12 hours', r."race_date"::timestamptz);--> statement-breakpoint
UPDATE "team_radio_clips" t SET "session_type" = 'sprint' FROM "races" r WHERE t."race_id" = r."id" AND r."sprint_date" IS NOT NULL AND t."date" < COALESCE(r."race_date_utc" - interval '12 hours', r."race_date"::timestamptz);
