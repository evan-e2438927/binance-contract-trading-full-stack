CREATE TABLE "leverage_bracket_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leverage_bracket_changes" ADD CONSTRAINT "leverage_bracket_changes_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lbc_symbol_changed_idx" ON "leverage_bracket_changes" USING btree ("symbol","changed_at" DESC NULLS LAST);