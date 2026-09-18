-- 只加数据库元数据层面的 COMMENT，不改任何表结构/数据。
-- 内容照抄 src/schema/*.ts 里已经写好的中文 JSDoc/行注释，方便在 Supabase Studio、
-- pgAdmin、psql \d+ 等工具里直接看到每张表/每个字段是干什么的。

-- ========== 市场规格 ==========

COMMENT ON TABLE "symbols" IS '币对规格表：下单校验的规格来源，数据来自币安 exchangeInfo，seed:symbols 每天同步一次。enabled/sort_order 是我们自己的运营字段。';
COMMENT ON COLUMN "symbols"."symbol" IS 'BTCUSDT 这种币安原生交易对代码，直接当主键';
COMMENT ON COLUMN "symbols"."base_asset" IS '标的资产，如 BTC';
COMMENT ON COLUMN "symbols"."quote_asset" IS '计价资产，如 USDT，本项目目前只对接 U 本位';
COMMENT ON COLUMN "symbols"."status" IS '币安那边的状态，如 TRADING/SETTLING，原样存';
COMMENT ON COLUMN "symbols"."price_precision" IS '价格小数位数，前端展示用';
COMMENT ON COLUMN "symbols"."quantity_precision" IS '数量小数位数，前端展示用';
COMMENT ON COLUMN "symbols"."tick_size" IS '价格最小变动单位，下单校验链要用';
COMMENT ON COLUMN "symbols"."step_size" IS '数量最小变动单位，下单校验链要用';
COMMENT ON COLUMN "symbols"."min_qty" IS '最小下单数量';
COMMENT ON COLUMN "symbols"."min_notional" IS '最小下单名义价值（价格 × 数量）';
COMMENT ON COLUMN "symbols"."min_price" IS 'PRICE_FILTER.minPrice，委托价/触发价下限';
COMMENT ON COLUMN "symbols"."max_price" IS 'PRICE_FILTER.maxPrice，委托价/触发价上限';
COMMENT ON COLUMN "symbols"."max_qty" IS 'LOT_SIZE.maxQty，限价类订单数量上限';
COMMENT ON COLUMN "symbols"."market_step_size" IS 'MARKET_LOT_SIZE.stepSize';
COMMENT ON COLUMN "symbols"."market_min_qty" IS 'MARKET_LOT_SIZE.minQty';
COMMENT ON COLUMN "symbols"."market_max_qty" IS 'MARKET_LOT_SIZE.maxQty，市价单数量上限';
COMMENT ON COLUMN "symbols"."percent_price_up" IS 'PERCENT_PRICE.multiplierUp，定标 1e8';
COMMENT ON COLUMN "symbols"."percent_price_down" IS 'PERCENT_PRICE.multiplierDown，定标 1e8';
COMMENT ON COLUMN "symbols"."max_num_orders" IS 'MAX_NUM_ORDERS.limit，每账户在该币对的挂单数上限';
COMMENT ON COLUMN "symbols"."liquidation_fee_rate" IS '币对字段 liquidationFee，强平清算费率';
COMMENT ON COLUMN "symbols"."enabled" IS '我们自己的字段：是否对用户开放，不是币安数据的一部分';
COMMENT ON COLUMN "symbols"."sort_order" IS '我们自己的字段：币对列表的展示顺序';

COMMENT ON TABLE "leverage_brackets" IS '杠杆分层表：强平价公式的输入。数据来自币安官方签名接口同步，不允许手写或让 AI 生成这里的数字。';
COMMENT ON COLUMN "leverage_brackets"."bracket" IS '层号，从 1 开始，层号越大杠杆上限越低';
COMMENT ON COLUMN "leverage_brackets"."notional_floor" IS '这一层的名义价值下限';
COMMENT ON COLUMN "leverage_brackets"."notional_cap" IS '这一层的名义价值上限';
COMMENT ON COLUMN "leverage_brackets"."max_leverage" IS '这一层允许的最大杠杆倍数';
COMMENT ON COLUMN "leverage_brackets"."mmr" IS '维持保证金率，定标 1e8，如 0.4% 存 400000';
COMMENT ON COLUMN "leverage_brackets"."cum" IS '速算额，配合 mmr 算维持保证金：名义价值 × mmr − cum';

COMMENT ON TABLE "leverage_bracket_changes" IS '杠杆分层表变更记录：每日同步发现币安调了表，就在这里留一份前后整表快照，只追加不更新不删除。';
COMMENT ON COLUMN "leverage_bracket_changes"."before" IS '变更前整表快照，十进制字符串（bigint 不进 JSON），首次导入为 []';
COMMENT ON COLUMN "leverage_bracket_changes"."after" IS '变更后整表快照';
COMMENT ON COLUMN "leverage_bracket_changes"."changed_at" IS '发现变化并写入的时间';

-- ========== 账户 ==========

COMMENT ON TABLE "accounts" IS '账户表：钱包余额的落点，只管交易相关状态（余额/持仓模式/昵称）。不记录任何登录方式，登录方式在 identities 表。';
COMMENT ON COLUMN "accounts"."wallet_balance" IS '已结算的钱包余额，须满足 accounts.wallet_balance = SUM(ledger_entries.amount)';
COMMENT ON COLUMN "accounts"."position_mode" IS 'ONE_WAY 单向持仓 / HEDGE 双向持仓';
COMMENT ON COLUMN "accounts"."last_reset_at" IS '上次账户重置的时间，null 表示没重置过';
COMMENT ON COLUMN "accounts"."nickname" IS '排行榜显示名，默认脱敏地址/邮箱';
COMMENT ON COLUMN "accounts"."last_seen_at" IS '最近一次活跃时间';

COMMENT ON TABLE "account_symbol_settings" IS '每账户每币对的交易偏好（杠杆倍数、全仓/逐仓）。没有记录 = 用默认值（20x 全仓）。';
COMMENT ON COLUMN "account_symbol_settings"."leverage" IS '该账户在该币对上、下一笔单要用的杠杆倍数（不影响已开仓位）';
COMMENT ON COLUMN "account_symbol_settings"."margin_mode" IS '全仓/逐仓，默认全仓';

COMMENT ON TABLE "identities" IS '登录身份：把"你是谁"和"你的钱"分开。三种登录方式都收敛成 (provider, provider_id)，应用层规定每个账户永远只挂一个身份。';
COMMENT ON COLUMN "identities"."provider_id" IS '按 provider 归一化后的标识：钱包地址小写/base58 原样，邮箱小写，Google 存 sub（不用 email，因为可换绑）';

COMMENT ON TABLE "auth_nonces" IS '钱包登录的一次性挑战值：证明用户持有该地址私钥。expiresAt 5 分钟有效期 + usedAt 用过即废两道防重放。可清理表。';
COMMENT ON COLUMN "auth_nonces"."nonce" IS '随机挑战值，拼进 message 里让用户签名，防重放攻击';
COMMENT ON COLUMN "auth_nonces"."message" IS '完整待签名原文，验签必须用这份服务端存的原文，不能用客户端回传的';
COMMENT ON COLUMN "auth_nonces"."expires_at" IS '有效期 5 分钟';
COMMENT ON COLUMN "auth_nonces"."used_at" IS '非空说明已经验签成功用过一次，防止重放';

COMMENT ON TABLE "email_verification_codes" IS '邮箱登录的一次性验证码，和 auth_nonces 同一个模式。只存哈希，不落明文。可清理表。';
COMMENT ON COLUMN "email_verification_codes"."email" IS '小写邮箱，和 identities.provider_id 同一种规范化';
COMMENT ON COLUMN "email_verification_codes"."code_hash" IS 'sha256(6 位验证码)，不存明文';
COMMENT ON COLUMN "email_verification_codes"."attempts" IS '输错次数，到 5 次这条记录作废';
COMMENT ON COLUMN "email_verification_codes"."expires_at" IS '有效期 5 分钟';
COMMENT ON COLUMN "email_verification_codes"."used_at" IS '非空说明已经验证成功用过一次';

-- ========== 交易 ==========

COMMENT ON TABLE "orders" IS '订单表：用户的委托意图 + 状态机，全库写入最频繁的表之一。executed_qty/avg_price 是 fills 的滚动汇总。';
COMMENT ON COLUMN "orders"."client_order_id" IS '前端生成的幂等键，配唯一索引，网络超时重试同一个值只会真正下单一次';
COMMENT ON COLUMN "orders"."side" IS 'BUY/SELL，交易动作方向（不是持仓方向）';
COMMENT ON COLUMN "orders"."position_side" IS '这笔单影响哪个仓位槽：单向模式恒为 BOTH，双向模式为 LONG/SHORT';
COMMENT ON COLUMN "orders"."time_in_force" IS '只对限价单有意义：GTC/IOC/FOK/GTX';
COMMENT ON COLUMN "orders"."price" IS '委托价，市价单为 null';
COMMENT ON COLUMN "orders"."stop_price" IS '触发单的触发价，非触发单为 null';
COMMENT ON COLUMN "orders"."working_type" IS '触发单用什么价格判断触发：MARK_PRICE 标记价（抗插针）/ CONTRACT_PRICE 最新成交价';
COMMENT ON COLUMN "orders"."qty" IS '委托数量';
COMMENT ON COLUMN "orders"."executed_qty" IS '已成交数量';
COMMENT ON COLUMN "orders"."avg_price" IS '已成交部分的加权平均价';
COMMENT ON COLUMN "orders"."reduce_only" IS '只减仓：不能开新仓，只能减少现有仓位';
COMMENT ON COLUMN "orders"."close_position" IS '一键平仓：不指定数量，直接清空整个仓位';
COMMENT ON COLUMN "orders"."triggered" IS '触发单是否已经被标记价/最新价触发过';
COMMENT ON COLUMN "orders"."queue_ahead" IS '拟真排队：从深度快照推算的前方还剩多少量没成交';
COMMENT ON COLUMN "orders"."queue_estimated" IS '排队位置是不是估算出来的（引擎重启后必然是）';
COMMENT ON COLUMN "orders"."frozen_margin" IS '这张挂单占用/冻结的保证金';
COMMENT ON COLUMN "orders"."reject_reason" IS '状态是 REJECTED/EXPIRED 时，记录具体是哪条错误码/原因';

COMMENT ON TABLE "positions" IS '仓位表："我现在手上拿着什么"，每次成交都要改。平仓后不删行（留 position_amt = 0）。';
COMMENT ON COLUMN "positions"."position_side" IS '单向模式恒为 BOTH，双向模式为 LONG/SHORT，各占一行独立记账';
COMMENT ON COLUMN "positions"."leverage" IS '开仓时锁定的杠杆倍数，后续调杠杆不影响已开的仓位';
COMMENT ON COLUMN "positions"."position_amt" IS '带符号持仓数量：多头为正、空头为负（对齐币安 GET /fapi/v3/positionRisk 的表示法）';
COMMENT ON COLUMN "positions"."entry_price" IS '加权平均开仓价';
COMMENT ON COLUMN "positions"."isolated_margin" IS '仅逐仓模式下有意义：划给这个仓位的保证金';
COMMENT ON COLUMN "positions"."opened_at" IS '首次开仓时间，position_amt 归零后不清空，留作历史记录';

COMMENT ON TABLE "fills" IS '成交明细：只追加不更新，是"这笔钱为什么变"的最细粒度证据。一张订单可拆成多笔 fill。';
COMMENT ON COLUMN "fills"."price" IS '这一笔的实际成交价（不是订单的委托价）';
COMMENT ON COLUMN "fills"."qty" IS '这一笔的成交数量';
COMMENT ON COLUMN "fills"."role" IS 'MAKER/TAKER，决定这一笔的手续费费率';
COMMENT ON COLUMN "fills"."fee" IS '这一笔的手续费，向上取整（mulCeil）';
COMMENT ON COLUMN "fills"."realized_pnl" IS '这一笔带来的已实现盈亏，只在减仓的 fill 上非零';
COMMENT ON COLUMN "fills"."is_liquidation" IS '这一笔是不是强平引起的';

-- ========== 账目 ==========

COMMENT ON TABLE "ledger_entries" IS '★ 资金流水，账目的唯一真相，只追加永不更新永不删除。不变式：accounts.wallet_balance = SUM(ledger_entries.amount)。';
COMMENT ON COLUMN "ledger_entries"."type" IS '这笔钱属于 LEDGER_TYPE 八类中的哪一类，没有"其它"这个兜底选项';
COMMENT ON COLUMN "ledger_entries"."symbol" IS '和某个币对相关的流水（如手续费/资金费）才填，INITIAL/RESET 这类为 null';
COMMENT ON COLUMN "ledger_entries"."amount" IS '有符号：收入为正，支出为负，SUM 出来就是余额';
COMMENT ON COLUMN "ledger_entries"."balance_after" IS '这笔发生后的余额快照，流水页直接展示，对账时可二分定位';
COMMENT ON COLUMN "ledger_entries"."ref_type" IS '关联的业务对象类型，如 fill/funding/liquidation';
COMMENT ON COLUMN "ledger_entries"."ref_id" IS '关联的业务对象 id，配合 ref_type 能查到这笔钱具体是哪次成交/结算引起的';

COMMENT ON TABLE "funding_payments" IS '资金费结算明细：每 8 小时一次，是那次结算的现场快照（当时的费率/标记价/名义价值）。';
COMMENT ON COLUMN "funding_payments"."funding_rate" IS '结算时使用的资金费率';
COMMENT ON COLUMN "funding_payments"."mark_price" IS '结算时使用的标记价';
COMMENT ON COLUMN "funding_payments"."notional" IS '结算时仓位的名义价值（= mark_price × qty）';
COMMENT ON COLUMN "funding_payments"."amount" IS '有符号：多头付给空头（或反之）时，付出方为负';
COMMENT ON COLUMN "funding_payments"."settled_at" IS '结算时间，每 8 小时一次';

COMMENT ON TABLE "liquidations" IS '强平记录：低频但每一条都可能被用户质疑，marginBalanceBefore/maintMarginAt 是取证字段，不能省。';
COMMENT ON COLUMN "liquidations"."margin_mode" IS '被强平时这个仓位是全仓还是逐仓';
COMMENT ON COLUMN "liquidations"."qty" IS '被强平的数量';
COMMENT ON COLUMN "liquidations"."entry_price" IS '被强平仓位的开仓均价';
COMMENT ON COLUMN "liquidations"."mark_price" IS '触发强平那一刻的标记价，强平按这个价格平仓（不是最新成交价，防插针）';
COMMENT ON COLUMN "liquidations"."realized_pnl" IS '强平这笔带来的已实现盈亏（通常是负的）';
COMMENT ON COLUMN "liquidations"."liquidation_fee" IS '强平清算费，比普通手续费高';
COMMENT ON COLUMN "liquidations"."margin_balance_before" IS '取证字段：强平前一刻的保证金余额';
COMMENT ON COLUMN "liquidations"."maint_margin_at" IS '取证字段：强平前一刻算出的维持保证金要求';

COMMENT ON TABLE "equity_snapshots" IS '每日权益快照：排行榜和收益曲线的数据源，每天 UTC 00:00 给每个账户拍一张照。';
COMMENT ON COLUMN "equity_snapshots"."snap_date" IS 'UTC 日期，每天一条';
COMMENT ON COLUMN "equity_snapshots"."equity" IS '权益 = 钱包余额 + 所有仓位未实现盈亏';
COMMENT ON COLUMN "equity_snapshots"."wallet_balance" IS '当天快照时刻的钱包余额（不含未实现盈亏）';
COMMENT ON COLUMN "equity_snapshots"."cumulative_pnl" IS '自上次账户重置以来（不是开户以来）的累计盈亏';
COMMENT ON COLUMN "equity_snapshots"."roi" IS '收益率，定标 1e8，排行榜按这个字段排序';

-- ========== 练手表，与业务无关 ==========

COMMENT ON TABLE "books" IS '⚠️ 练手表，和合约业务无关：早前为跑通 Next.js → Hono → Drizzle → Supabase 全栈链路留下的（见 docs/books-tutorial.md）。不要照它的风格建业务表，也不要往它上面加字段。';
