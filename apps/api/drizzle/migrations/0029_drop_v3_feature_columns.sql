-- weighted-v3's rows have no weighted-v4 equivalent and 0030 adds a NOT NULL features column, so they
-- are cleared here: scripts/backfill_all_predictions.py rewrites every GP prediction as weighted-v4.
DELETE FROM "driver_prediction_features";--> statement-breakpoint
ALTER TABLE "race_predictions" ALTER COLUMN "model_version" SET DEFAULT 'weighted-v4';--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "car_performance_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "driver_rating_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "starting_position_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "win_rate_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "luck_factor_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "weather_impact_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "track_overtake_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "position_gain_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "long_run_pace_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "reliability_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "qualifying_delta_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "sector_strength_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "tyre_deg_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "circuit_adj_start_pos_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "circuit_adj_position_gain_score";--> statement-breakpoint
ALTER TABLE "driver_prediction_features" DROP COLUMN "long_run_used_fp";