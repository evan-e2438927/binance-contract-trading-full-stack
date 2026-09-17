ALTER TYPE "public"."order_type" ADD VALUE 'LIQUIDATION';--> statement-breakpoint
DROP INDEX "pos_symbol_open_idx";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "working_type" SET DEFAULT 'CONTRACT_PRICE';--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "min_price" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "max_price" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "max_qty" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "market_step_size" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "market_min_qty" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "market_max_qty" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "percent_price_up" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "percent_price_down" bigint;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "max_num_orders" integer;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "liquidation_fee_rate" bigint;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "position_amt" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "pos_symbol_open_idx" ON "positions" USING btree ("symbol") WHERE position_amt <> 0;