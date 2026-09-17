CREATE TYPE "public"."auth_provider" AS ENUM('wallet_evm', 'wallet_solana', 'email', 'google');--> statement-breakpoint
CREATE TABLE "email_verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "accounts_chain_address_uq";--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_codes_email_idx" ON "email_verification_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_codes_expires_idx" ON "email_verification_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_uq" ON "identities" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "identities_account_idx" ON "identities" USING btree ("account_id");--> statement-breakpoint
-- 手写：删列之前把已有账户的钱包地址搬进 identities（chain evm/solana → provider wallet_evm/wallet_solana），
-- 否则老账户会丢掉登录身份。建唯一索引之后再搬，重复数据会让迁移直接失败而不是悄悄吞掉。
INSERT INTO "identities" ("account_id", "provider", "provider_id", "created_at")
SELECT "id", ('wallet_' || "chain"::text)::"auth_provider", "address", "created_at" FROM "accounts";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "chain";