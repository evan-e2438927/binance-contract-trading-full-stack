CREATE TYPE "public"."chain" AS ENUM('evm', 'solana');--> statement-breakpoint
CREATE TYPE "public"."fill_role" AS ENUM('MAKER', 'TAKER');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('INITIAL', 'RESET', 'REALIZED_PNL', 'FEE', 'FUNDING', 'LIQUIDATION', 'LIQUIDATION_FEE', 'MARGIN_TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."margin_mode" AS ENUM('CROSS', 'ISOLATED');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET');--> statement-breakpoint
CREATE TYPE "public"."position_mode" AS ENUM('ONE_WAY', 'HEDGE');--> statement-breakpoint
CREATE TYPE "public"."position_side" AS ENUM('BOTH', 'LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."time_in_force" AS ENUM('GTC', 'IOC', 'FOK', 'GTX');--> statement-breakpoint
CREATE TYPE "public"."working_type" AS ENUM('MARK_PRICE', 'CONTRACT_PRICE');--> statement-breakpoint
CREATE TABLE "account_symbol_settings" (
	"account_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"leverage" integer DEFAULT 20 NOT NULL,
	"margin_mode" "margin_mode" DEFAULT 'CROSS' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_symbol_settings_account_id_symbol_pk" PRIMARY KEY("account_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"chain" "chain" NOT NULL,
	"wallet_balance" bigint DEFAULT 0 NOT NULL,
	"position_mode" "position_mode" DEFAULT 'ONE_WAY' NOT NULL,
	"last_reset_at" timestamp with time zone,
	"nickname" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"chain" "chain" NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"snap_date" date NOT NULL,
	"equity" bigint NOT NULL,
	"wallet_balance" bigint NOT NULL,
	"cumulative_pnl" bigint NOT NULL,
	"roi" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" "order_side" NOT NULL,
	"position_side" "position_side" NOT NULL,
	"price" bigint NOT NULL,
	"qty" bigint NOT NULL,
	"role" "fill_role" NOT NULL,
	"fee" bigint NOT NULL,
	"realized_pnl" bigint DEFAULT 0 NOT NULL,
	"is_liquidation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"position_side" "position_side" NOT NULL,
	"funding_rate" bigint NOT NULL,
	"mark_price" bigint NOT NULL,
	"notional" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"settled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leverage_brackets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"bracket" integer NOT NULL,
	"notional_floor" bigint NOT NULL,
	"notional_cap" bigint NOT NULL,
	"max_leverage" integer NOT NULL,
	"mmr" bigint NOT NULL,
	"cum" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"symbol" text PRIMARY KEY NOT NULL,
	"base_asset" text NOT NULL,
	"quote_asset" text NOT NULL,
	"status" text NOT NULL,
	"price_precision" integer NOT NULL,
	"quantity_precision" integer NOT NULL,
	"tick_size" bigint NOT NULL,
	"step_size" bigint NOT NULL,
	"min_qty" bigint NOT NULL,
	"min_notional" bigint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "ledger_type" NOT NULL,
	"symbol" text,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liquidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"position_side" "position_side" NOT NULL,
	"margin_mode" "margin_mode" NOT NULL,
	"qty" bigint NOT NULL,
	"entry_price" bigint NOT NULL,
	"mark_price" bigint NOT NULL,
	"realized_pnl" bigint NOT NULL,
	"liquidation_fee" bigint NOT NULL,
	"margin_balance_before" bigint NOT NULL,
	"maint_margin_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_order_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" "order_side" NOT NULL,
	"position_side" "position_side" NOT NULL,
	"type" "order_type" NOT NULL,
	"time_in_force" time_in_force DEFAULT 'GTC' NOT NULL,
	"price" bigint,
	"stop_price" bigint,
	"working_type" "working_type" DEFAULT 'MARK_PRICE' NOT NULL,
	"qty" bigint NOT NULL,
	"executed_qty" bigint DEFAULT 0 NOT NULL,
	"avg_price" bigint DEFAULT 0 NOT NULL,
	"reduce_only" boolean DEFAULT false NOT NULL,
	"close_position" boolean DEFAULT false NOT NULL,
	"status" "order_status" DEFAULT 'NEW' NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"queue_ahead" bigint DEFAULT 0 NOT NULL,
	"queue_estimated" boolean DEFAULT false NOT NULL,
	"frozen_margin" bigint DEFAULT 0 NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"position_side" "position_side" NOT NULL,
	"margin_mode" "margin_mode" NOT NULL,
	"leverage" integer NOT NULL,
	"qty" bigint DEFAULT 0 NOT NULL,
	"entry_price" bigint DEFAULT 0 NOT NULL,
	"isolated_margin" bigint DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_symbol_settings" ADD CONSTRAINT "account_symbol_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_symbol_settings" ADD CONSTRAINT "account_symbol_settings_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_payments" ADD CONSTRAINT "funding_payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_brackets" ADD CONSTRAINT "leverage_brackets_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidations" ADD CONSTRAINT "liquidations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_chain_address_uq" ON "accounts" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "nonces_addr_idx" ON "auth_nonces" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "nonces_expires_idx" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "equity_acc_date_uq" ON "equity_snapshots" USING btree ("account_id","snap_date");--> statement-breakpoint
CREATE INDEX "equity_date_roi_idx" ON "equity_snapshots" USING btree ("snap_date","roi" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fills_acc_created_idx" ON "fills" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fills_order_idx" ON "fills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "funding_acc_settled_idx" ON "funding_payments" USING btree ("account_id","settled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "funding_uq" ON "funding_payments" USING btree ("account_id","symbol","position_side","settled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lb_symbol_bracket_uq" ON "leverage_brackets" USING btree ("symbol","bracket");--> statement-breakpoint
CREATE INDEX "lb_symbol_cap_idx" ON "leverage_brackets" USING btree ("symbol","notional_cap");--> statement-breakpoint
CREATE INDEX "ledger_acc_created_idx" ON "ledger_entries" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_acc_type_idx" ON "ledger_entries" USING btree ("account_id","type");--> statement-breakpoint
CREATE INDEX "liq_acc_created_idx" ON "liquidations" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "orders_acc_client_uq" ON "orders" USING btree ("account_id","client_order_id");--> statement-breakpoint
CREATE INDEX "orders_open_idx" ON "orders" USING btree ("symbol","status") WHERE status IN ('NEW','PARTIALLY_FILLED');--> statement-breakpoint
CREATE INDEX "orders_acc_created_idx" ON "orders" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "pos_acc_sym_side_uq" ON "positions" USING btree ("account_id","symbol","position_side");--> statement-breakpoint
CREATE INDEX "pos_symbol_open_idx" ON "positions" USING btree ("symbol") WHERE qty > 0;