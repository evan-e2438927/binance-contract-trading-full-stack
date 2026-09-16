import {
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

export const chainEnum = pgEnum("chain", CHAIN); //账户登录用的链。
export const positionModeEnum = pgEnum("position_mode", POSITION_MODE); // 持仓模式
export const positionSideEnum = pgEnum("position_side", POSITION_SIDE); //仓位/订单归属的方向槽位
export const marginModeEnum = pgEnum("margin_mode", MARGIN_MODE); // 保证金模式
export const orderSideEnum = pgEnum("order_side", ORDER_SIDE); // 订单的买卖方向。注意这是"交易动作"
export const orderTypeEnum = pgEnum("order_type", ORDER_TYPE); // 订单类型。触发单
export const timeInForceEnum = pgEnum("time_in_force", TIME_IN_FORCE); // 订单有效方式
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUS); // 订单状态机的六个状态
export const fillRoleEnum = pgEnum("fill_role", FILL_ROLE); // 成交时这笔单扮演的角色
export const workingTypeEnum = pgEnum("working_type", WORKING_TYPE); // 触发单用哪种价格判断"到没到触发点"。
export const ledgerTypeEnum = pgEnum("ledger_type", LEDGER_TYPE); // 资金流水的类型
