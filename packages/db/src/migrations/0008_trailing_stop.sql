ALTER TYPE "public"."order_type" ADD VALUE 'TRAILING_STOP_MARKET' BEFORE 'LIQUIDATION';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "activation_price" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "callback_rate" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracked_price" bigint;--> statement-breakpoint
COMMENT ON COLUMN "orders"."activation_price" IS '跟踪委托的激活价：最有利价穿过它这张单才开始算回撤；下单不传时取下单那一刻的参照价。其它类型为 null';--> statement-breakpoint
COMMENT ON COLUMN "orders"."callback_rate" IS '跟踪委托的回调率，百分数定标（1% 存 100000000）。币安接口允许 0.1 ~ 10。其它类型为 null';--> statement-breakpoint
COMMENT ON COLUMN "orders"."tracked_price" IS '跟踪委托下单以来追到的最有利价：卖单记最高价、买单记最低价。其它类型为 null';
