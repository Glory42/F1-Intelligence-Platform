ALTER TABLE "driver_sprint_features" ALTER COLUMN "car_performance_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_sprint_features" ALTER COLUMN "starting_position_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_sprint_features" ALTER COLUMN "driver_rating_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_sprint_features" ALTER COLUMN "short_run_pace_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_sprint_features" ALTER COLUMN "weather_impact_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_sprint_features" ALTER COLUMN "win_rate_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_sprint_features" ALTER COLUMN "luck_factor_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_sprint_features" ADD COLUMN "features" jsonb;