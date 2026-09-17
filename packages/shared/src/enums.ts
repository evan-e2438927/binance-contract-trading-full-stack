/**
 * 账户登录用的链。'evm' 对应 MetaMask 等 EVM 钱包，'solana' 对应 Phantom 等。
 * 和地址一起构成 accounts 表的唯一键——同一个人用两条链登录会得到两个独立账户（有意的）。
 */
export const CHAIN = ["evm", "solana"] as const;
export type Chain = (typeof CHAIN)[number];

/**
 * 持仓模式（账户级设置，第 6 讲的 accounts 表里能看到）。
 * - ONE_WAY 单向持仓：同一币对同一时间只能持多或持空一个方向，两个方向共用一个仓位槽。
 * - HEDGE   双向持仓：同一币对可以同时开多、开空两个独立仓位（对冲用）。
 */
export const POSITION_MODE = ["ONE_WAY", "HEDGE"] as const;
export type PositionMode = (typeof POSITION_MODE)[number];

/**
 * 仓位/订单归属的方向槽位，和 ORDER_SIDE（买/卖）是两个不同维度，别混。
 * - BOTH  单向模式下用——不区分多空，只有一个仓位槽。
 * - LONG  双向模式下的多头仓位。
 * - SHORT 双向模式下的空头仓位。
 */
export const POSITION_SIDE = ["BOTH", "LONG", "SHORT"] as const;
export type PositionSide = (typeof POSITION_SIDE)[number];

/**
 * 保证金模式（可以每个币对单独设置，见第 6 讲的 account_symbol_settings 表）。
 * - CROSS    全仓：这个币对的仓位用整个钱包余额做保证金，仓位之间互相"输血"。
 * - ISOLATED 逐仓：只用分配给这个仓位的保证金，独立算强平价，亏光了也不影响钱包其他部分。
 */
export const MARGIN_MODE = ["CROSS", "ISOLATED"] as const;
export type MarginMode = (typeof MARGIN_MODE)[number];

/**
 * 订单的买卖方向。注意这是"交易动作"，不等于"开多/开空"——
 * 开空仓也是先 SELL，只是 positionSide 传 SHORT；reduceOnly 平多仓同样要 SELL。
 */
export const ORDER_SIDE = ["BUY", "SELL"] as const;
export type OrderSide = (typeof ORDER_SIDE)[number];

/**
 * 订单类型。触发单（STOP 系列）平时不占盘口、不冻结保证金，
 * 标记价触及 stopPrice 才会"激活"——具体触发规则见 04-backend-design.md 第 7 节。
 * - LIMIT               限价单：按指定价格排队等成交。
 * - MARKET              市价单：立刻按当前盘口逐档吃单成交。
 * - STOP                止损限价单：触发后以 price 挂一张限价单。
 * - STOP_MARKET         止损市价单：触发后立即按市价成交。
 * - TAKE_PROFIT         止盈限价单：触发后以 price 挂一张限价单。
 * - TAKE_PROFIT_MARKET  止盈市价单：触发后立即按市价成交。
 * - LIQUIDATION         强平单：系统在强平时代替用户下的单，用户不能手动下（和币安订单类型一致，第 07 讲）。
 *                       有了它，强平成交的 fills.order_id 才有订单可引用（设计缺口 #7）。
 */
export const ORDER_TYPE = [
  "LIMIT",
  "MARKET",
  "STOP",
  "STOP_MARKET",
  "TAKE_PROFIT",
  "TAKE_PROFIT_MARKET",
  "LIQUIDATION",
] as const;
export type OrderType = (typeof ORDER_TYPE)[number];

/**
 * 订单有效方式（Time In Force），只对限价单有意义。
 * - GTC 一直有效，直到成交或被撤单（默认）。
 * - IOC 立即成交能成的部分，没成交的部分立刻取消，不留在盘口上。
 * - FOK 必须一次性全部成交，否则整单立刻取消，不接受部分成交。
 * - GTX 只做 Maker（Post Only）：如果这单下去会立即和对手盘成交，直接拒单，不允许吃单。
 */
export const TIME_IN_FORCE = ["GTC", "IOC", "FOK", "GTX"] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

/**
 * 订单状态机的六个状态，状态流转图见 04-backend-design.md 第 3 节。
 * NEW/PARTIALLY_FILLED 是"活跃"状态（对应第 7 讲 orders 表那个部分索引）；
 * 其余四个都是终态，进去了就不会再变。
 * - NEW               已挂单，尚未成交。
 * - PARTIALLY_FILLED  部分成交，剩余部分还在排队。
 * - FILLED            完全成交（终态）。
 * - CANCELED          用户主动撤单（终态）。
 * - EXPIRED           IOC 未成交部分 / FOK 未全部成交 / GTX 会吃单 / 触发时保证金不足等原因失效（终态）。
 * - REJECTED          下单校验链（04-backend-design.md 第 6 节）没通过，直接拒绝，不会进入挂单簿（终态）。
 */
export const ORDER_STATUS = [
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "EXPIRED",
  "REJECTED",
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

/**
 * 成交时这笔单扮演的角色，决定手续费费率（Maker 更低，鼓励挂单提供流动性）。
 * - MAKER 挂单方：这笔成交是靠"别人的单吃到了我挂在盘口上的单"促成的。
 * - TAKER 吃单方：这笔成交是靠"我主动吃掉了盘口上已有的挂单"促成的。
 */
export const FILL_ROLE = ["MAKER", "TAKER"] as const;
export type FillRole = (typeof FILL_ROLE)[number];

/**
 * 触发单用哪种价格判断"到没到触发点"。
 * - MARK_PRICE     标记价：能防止有人用小单插针把别人的止损打出来。
 * - CONTRACT_PRICE 合约最新成交价：更贴近"眼见为实"，但更容易被插针。
 * 默认值是 CONTRACT_PRICE，和币安条件单接口一致（2026-09-17 定，见 docs/tutorial/04-order-validation.md 第 7 节）。
 */
export const WORKING_TYPE = ["MARK_PRICE", "CONTRACT_PRICE"] as const;
export type WorkingType = (typeof WORKING_TYPE)[number];

/**
 * 资金流水的类型——ledger_entries 表（第 8 讲）里每一行都必须归到这 8 类之一，
 * 这是"钱从哪来、到哪去"的唯一分类依据，账目对不上时靠这个字段定位是哪类操作出的问题。
 * - INITIAL          开户时发放的初始模拟资金。
 * - RESET            账户重置（走正常平仓流程后把余额设回初始值，见 CLAUDE.md 已知失真点 #10）。
 * - REALIZED_PNL     平仓（部分或全部）产生的已实现盈亏。
 * - FEE              交易手续费（Maker/Taker）。
 * - FUNDING          资金费结算（每 8 小时，多空双方互相支付）。
 * - LIQUIDATION      强平时该仓位的盈亏结算。
 * - LIQUIDATION_FEE  强平清算费。
 * - MARGIN_TRANSFER  逐仓模式下手动划入/划出保证金。
 */
export const LEDGER_TYPE = [
  "INITIAL",
  "RESET",
  "REALIZED_PNL",
  "FEE",
  "FUNDING",
  "LIQUIDATION",
  "LIQUIDATION_FEE",
  "MARGIN_TRANSFER",
] as const;
export type LedgerType = (typeof LEDGER_TYPE)[number];