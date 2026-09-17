import {
  AUTH_PROVIDER,
  CHAIN,
  FILL_ROLE,
  LEDGER_TYPE,
  MARGIN_MODE,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  POSITION_MODE,
  POSITION_SIDE,
  TIME_IN_FORCE,
  WORKING_TYPE,
} from "@binance-contract-trading-full-stack/shared";
import { pgEnum } from "drizzle-orm/pg-core";

// 枚举值本身定义在 packages/shared/src/enums.ts，这里只是把同一份常量声明成 pg enum，
// 保证「数据库里能存的值」和「TypeScript 里的联合类型」不会各自漂移。

export const chainEnum = pgEnum("chain", CHAIN); // 钱包登录用的链：evm / solana（auth_nonces 用）

// 登录身份来源：钱包（按链分两种）/ 邮箱 / Google。identities 表靠 (provider, providerId) 找到账户。
export const authProviderEnum = pgEnum("auth_provider", AUTH_PROVIDER);

// 账户级设置：ONE_WAY 同一币对只有一个净仓位，反向下单即平仓/反手；
// HEDGE 多空各占一个独立仓位槽，可同时持有。切换前该币对必须无持仓无挂单。
export const positionModeEnum = pgEnum("position_mode", POSITION_MODE);

// 仓位/订单归属的方向槽位。ONE_WAY 模式下恒为 BOTH；HEDGE 模式下是 LONG 或 SHORT。
export const positionSideEnum = pgEnum("position_side", POSITION_SIDE);

// 保证金模式：CROSS 全仓，整个钱包余额给所有仓位兜底，爆仓则全账户一起爆；
// ISOLATED 逐仓，每个仓位只用划给它的那笔保证金，最多亏光那一笔。
export const marginModeEnum = pgEnum("margin_mode", MARGIN_MODE);

// 订单的买卖方向。注意这是「交易动作」而不是「持仓方向」：
// 在 HEDGE 模式下，SELL + positionSide=LONG 是平多，SELL + positionSide=SHORT 才是开空。
export const orderSideEnum = pgEnum("order_side", ORDER_SIDE);

// 订单类型。LIMIT/MARKET 是普通单，下单即进撮合；
// STOP/TAKE_PROFIT 系列是触发单，触发前只被价格流盯着，不占订单簿。
export const orderTypeEnum = pgEnum("order_type", ORDER_TYPE);

// 订单有效方式，只对限价单有意义：GTC 一直挂到成交或撤销；IOC 立刻成交剩余撤销；
// FOK 要么全部成交要么整单撤销；GTX 只做 Maker，会立刻成交就直接撤掉。
export const timeInForceEnum = pgEnum("time_in_force", TIME_IN_FORCE);

// 订单状态机的六个状态。NEW → PARTIALLY_FILLED → FILLED 是正常路径，
// CANCELED / EXPIRED / REJECTED 是三种终止方式，都要在 rejectReason 里留下原因。
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUS);

// 成交时这笔单扮演的角色，决定手续费费率：MAKER 挂单等着被吃（费率低甚至为负），
// TAKER 主动吃掉别人的挂单（费率高）。同一张订单的不同 fill 可能角色不同。
export const fillRoleEnum = pgEnum("fill_role", FILL_ROLE);

// 触发单用哪种价格判断「到没到触发点」：MARK_PRICE 标记价（抗插针，推荐），
// CONTRACT_PRICE 最新成交价（跟手，但一根插针就能把止损打掉）。
export const workingTypeEnum = pgEnum("working_type", WORKING_TYPE);

// 资金流水的类型，是 ledger_entries 里每一笔钱的归类。
// 所有资金变动都必须落在这八类之一，没有「其它」这个兜底选项——
// 出现分不了类的资金变动，说明业务逻辑有缺口，该补类型而不是硬塞。
export const ledgerTypeEnum = pgEnum("ledger_type", LEDGER_TYPE);
