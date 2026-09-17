import {
  SCALE,
  alignQty,
  divRound,
  format,
  mul,
  mulCeil,
  type ErrorCode,
  type Fixed,
  type MarginMode,
  type OrderType,
  type PositionMode,
  type TimeInForce,
  type WorkingType,
} from "@binance-contract-trading-full-stack/shared";
import { availableBalance, frozenMargin, initialMargin, notional, unrealizedPnl } from "./formulas";
import { findBracket } from "./liquidation";
import { positionKey, settingOf, type EngineState } from "./state";
import type { Account, Level, PlaceOrderRequest, Position, SymbolSpec } from "./types";

/**
 * 04-backend-design.md 第 6 节：下单校验链，13 步，**顺序不能换**。
 *
 * 只读 EngineState，不改任何东西——校验通过之后怎么成交、怎么挂单是第 05/06 讲的事。
 * 任何一步失败立刻返回错误码 + 带具体数字的中文提示，后面的步骤不再执行。
 *
 * 单向持仓模式下仓位怎么存（第 04 讲定下的，见 docs/tutorial/04-order-validation.md 第 2 节）：
 * 订单上的 positionSide 是 BOTH，但**仓位在引擎内部按实际方向存成 LONG 或 SHORT**
 * （04-backend-design.md 第 3 节："单向模式对外暴露 BOTH，内部仍用 LONG/SHORT 表示方向"）。
 * qty 恒为非负，不存方向就分不清单向模式下手上拿的是多还是空。
 */

/** 仓位的实际方向。单向模式的 BOTH 在引擎内部也会落到这两个之一。 */
export type Direction = "LONG" | "SHORT";

/** 校验通过后，第 05/06 讲接着要用的东西——都是校验过程中顺手算出来的，不让下一讲再算一遍。 */
export interface ValidatedOrder {
  spec: SymbolSpec;
  /** 补齐默认值后的 TIF。市价类订单没有 TIF 的概念，填 GTC（和 orders 表的列默认值一致）。 */
  timeInForce: TimeInForce;
  /** 补齐默认值后的触发价格类型。默认 CONTRACT_PRICE（最新成交价），和币安条件单接口的默认值一致。 */
  workingType: WorkingType;
  /** closePosition 单为 0n：数量在触发那一刻按仓位现算。 */
  qty: Fixed;
  reduceOnly: boolean;
  closePosition: boolean;
  /** 开仓 / 加仓会落到哪个方向的仓位。 */
  openSide: Direction;
  /** 减仓会作用于哪个方向的仓位。双向模式下和 openSide 相同，单向模式下和 openSide 相反。 */
  closeSide: Direction;
  /** 这张单里用来平掉现有仓位的数量。 */
  closeQty: Fixed;
  /** 这张单里用来开新仓 / 加仓的数量。closeQty + openQty = qty（closePosition 单除外）。 */
  openQty: Fixed;
  leverageNum: number;
  marginMode: MarginMode;
  /**
   * 开仓部分需要的保证金（起始保证金 + 按 Taker 费率预留的手续费）。
   * 限价单：就是这张挂单的 frozenMargin。市价单：只用于第 10 步判断，成交时按真实成交价重算。
   * 纯减仓单、未触发的触发单：0n。
   */
  requiredMargin: Fixed;
}

export type OrderValidation =
  | { ok: true; order: ValidatedOrder }
  | { ok: false; code: ErrorCode; message: string };

const TRIGGER_TYPES: readonly OrderType[] = ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"];
/** 需要委托价 price 的类型：限价单，以及触发后挂限价单的两种触发单。 */
const PRICED_TYPES: readonly OrderType[] = ["LIMIT", "STOP", "TAKE_PROFIT"];
const CLOSE_POSITION_TYPES: readonly OrderType[] = ["STOP_MARKET", "TAKE_PROFIT_MARKET"];

export function validateOrder(
  state: EngineState,
  accountId: string,
  req: PlaceOrderRequest,
): OrderValidation {
  // 账户不存在不是"业务拒绝"：鉴权通过的请求一定有账户，走到这里说明宿主接线错了
  const account = state.accounts.get(accountId);
  if (!account) {
    throw new Error(`账户 ${accountId} 不在引擎里，宿主必须先 registerAccount 再下单`);
  }

  // ① 币对存在、币安状态是 TRADING、我们对用户开放
  //    注意和行情输入的区别：行情层传来未知币对是程序错误（抛错），用户下单填错币对是业务拒绝
  const spec = state.symbols.get(req.symbol);
  if (!spec || spec.status !== "TRADING" || !spec.enabled) {
    return reject("SYMBOL_NOT_TRADING", spec ? `${req.symbol} 暂停交易` : `不支持的交易对 ${req.symbol}`);
  }

  // ② 行情就绪：两边盘口都有、有标记价。缺任何一样都没法判断成交和保证金，宁可不接单
  const book = state.books.get(req.symbol);
  const mark = state.marks.get(req.symbol);
  if (!book || book.bids.length === 0 || book.asks.length === 0 || !mark) {
    return reject("MARKET_NOT_READY", `${req.symbol} 行情尚未就绪，暂不接受下单`);
  }
  const markPrice = mark.markPrice;

  // ③ 参数组合
  const paramsError = checkParams(req, account.positionMode);
  if (paramsError) return reject("INVALID_PARAMS", paramsError);
  const isTrigger = TRIGGER_TYPES.includes(req.type);
  const closePosition = req.closePosition === true;
  const reduceOnly = req.reduceOnly === true;
  const qty = req.qty ?? 0n; // 第 3 步保证了：只有 closePosition 单才会没有 qty

  // ④ 持仓模式匹配
  if (account.positionMode === "HEDGE" && req.positionSide === "BOTH") {
    return reject("POSITION_SIDE_MISMATCH", "当前是双向持仓模式，positionSide 必须是 LONG 或 SHORT");
  }
  if (account.positionMode === "ONE_WAY" && req.positionSide !== "BOTH") {
    return reject("POSITION_SIDE_MISMATCH", `当前是单向持仓模式，positionSide 必须是 BOTH，收到 ${req.positionSide}`);
  }

  // ⑤ 价格、数量的交易规则（币安 PRICE_FILTER / LOT_SIZE / MARKET_LOT_SIZE）
  //    价格：在 [minPrice, maxPrice] 内，且 (价格 − minPrice) 是 tickSize 的整数倍；触发价也是价格，同样要查
  //    数量：在 [minQty, maxQty] 内，且 (数量 − minQty) 是 stepSize 的整数倍；市价单用 MARKET_LOT_SIZE 那一组
  for (const [label, value] of [
    ["委托价", req.price],
    ["触发价", req.stopPrice],
  ] as const) {
    if (value === undefined) continue;
    if (value < spec.minPrice || value > spec.maxPrice) {
      return reject(
        "PRICE_FILTER",
        `${label} ${show(value)} 超出允许范围 ${show(spec.minPrice)} ~ ${show(spec.maxPrice)}`,
      );
    }
    if ((value - spec.minPrice) % spec.tickSize !== 0n) {
      return reject("PRICE_FILTER", `${label} ${show(value)} 不是最小价格变动 ${show(spec.tickSize)} 的整数倍`);
    }
  }
  const lot =
    req.type === "MARKET"
      ? { label: "市价单数量", minQty: spec.marketMinQty, maxQty: spec.marketMaxQty, stepSize: spec.marketStepSize }
      : { label: "数量", minQty: spec.minQty, maxQty: spec.maxQty, stepSize: spec.stepSize };
  const base = baseAsset(req.symbol);
  if (!closePosition) {
    if (qty < lot.minQty) {
      return reject("LOT_SIZE", `${lot.label} ${show(qty)} ${base} 低于最小下单量 ${show(lot.minQty)} ${base}`);
    }
    if (qty > lot.maxQty) {
      return reject("LOT_SIZE", `${lot.label} ${show(qty)} ${base} 超过最大下单量 ${show(lot.maxQty)} ${base}`);
    }
    if ((qty - lot.minQty) % lot.stepSize !== 0n) {
      return reject("LOT_SIZE", `${lot.label} ${show(qty)} 不是最小数量变动 ${show(lot.stepSize)} 的整数倍`);
    }
  }

  // 方向：这张单开仓会落到哪边、减仓会作用于哪边
  const openSide: Direction =
    account.positionMode === "HEDGE" ? (req.positionSide as Direction) : req.side === "BUY" ? "LONG" : "SHORT";
  const closeSide: Direction = account.positionMode === "HEDGE" ? openSide : opposite(openSide);
  // 双向模式下 SELL + LONG（平多）、BUY + SHORT（平空）天生就是减仓，不管有没有勾 reduceOnly
  const hedgeClosing =
    account.positionMode === "HEDGE" &&
    ((req.side === "SELL" && req.positionSide === "LONG") || (req.side === "BUY" && req.positionSide === "SHORT"));
  // 双向模式不能传 reduceOnly、closePosition 方向也在第 3 步查过了，所以双向模式只看方向
  const closingIntent = account.positionMode === "HEDGE" ? hedgeClosing : reduceOnly || closePosition;

  // ⑥ 最小名义价值（币安 MIN_NOTIONAL）
  //    减仓类订单不查（币安 -4164："…no smaller than 5.0 (unless you choose reduce only)"）：
  //    仓位被部分平掉、价格下跌之后，剩下的一点点仓位名义价值可能已经低于门槛，要是连它都不让平，用户就被困住了
  if (!closePosition && !closingIntent) {
    const value = notional(qty, referencePrice(req, book));
    if (value < spec.minNotional) {
      return reject("MIN_NOTIONAL", `名义价值 ${show(value)} USDT 低于最小下单金额 ${show(spec.minNotional)} USDT`);
    }
  }

  // ⑦ 价格保护（币安 PERCENT_PRICE）：价格必须落在 [标记价 × multiplierDown, 标记价 × multiplierUp]，恰好在边界上放行
  //    限价单查委托价（币安 -4016 / -4024）；市价单查对手方最优价（币安 -4131）——盘口离标记价太远时
  //    市价单成交价会很离谱，币安直接拒。上下限按币对配置，BTCUSDT 是 1.05 / 0.95。
  //    STOP / TAKE_PROFIT 的委托价要到触发那一刻才挂出去，和现在的标记价比没有意义（第 09 讲）
  if (req.type === "LIMIT" || req.type === "MARKET") {
    const isLimit = req.type === "LIMIT";
    const price = isLimit ? req.price! : (req.side === "BUY" ? book.asks : book.bids)[0]!.price;
    const upper = mul(markPrice, spec.percentPriceUp);
    const lower = mul(markPrice, spec.percentPriceDown);
    if (price > upper || price < lower) {
      const range = `标记价 ${show(markPrice)} 下允许范围 ${show(lower)} ~ ${show(upper)}`;
      return reject(
        "PERCENT_PRICE",
        isLimit
          ? `委托价 ${show(price)} 超出价格保护范围：${range}`
          : `对手方最优价 ${show(price)} 超出价格保护范围，市价单暂不接受：${range}`,
      );
    }
  }

  // ⑧ 只减仓：必须有对应仓位，数量不能超过仓位
  const closeTarget = activePosition(state, account, req.symbol, closeSide);
  let closeQty = 0n;
  let openQty = 0n;
  if (closingIntent) {
    const sideName = directionName(closeSide);
    if (!closeTarget) {
      return reject("REDUCE_ONLY_REJECTED", `没有可以减少的${sideName}仓位`);
    }
    if (!closePosition && qty > closeTarget.qty) {
      return reject(
        "REDUCE_ONLY_REJECTED",
        `减仓数量 ${show(qty)} ${base} 超过了${sideName}仓位剩余 ${show(closeTarget.qty)} ${base}`,
      );
    }
    closeQty = closePosition ? closeTarget.qty : qty;
  } else if (account.positionMode === "ONE_WAY" && closeTarget) {
    // 单向模式反手：先平掉反方向的仓位，剩下的才是开仓
    closeQty = qty < closeTarget.qty ? qty : closeTarget.qty;
    openQty = qty - closeQty;
  } else {
    openQty = qty;
  }

  const setting = settingOf(state, accountId, req.symbol);
  const leverageNum = setting.leverageNum;
  const oppositeLevels = req.side === "BUY" ? book.asks : book.bids;
  let requiredMargin = 0n;

  // ⑨ ⑩ 只对"会开仓"的部分做。未触发的触发单不占保证金，触发那一刻再走一遍（第 09 讲）
  if (openQty > 0n && !isTrigger) {
    // 开仓部分的成本：市价单按盘口逐档估（先被平仓部分吃掉的档位跳过），限价单按委托价
    const cost =
      req.type === "MARKET"
        ? walkBook(oppositeLevels, closeQty, openQty, state.config.fees.takerFeeRate)
        : { notional: notional(openQty, req.price!), fee: 0n };

    // ⑨ 杠杆分层：成交后这个方向的总名义价值 = 现有仓位（按标记价）+ 同方向其它开仓挂单 + 本单
    const brackets = state.brackets.get(req.symbol)!;
    const held = activePosition(state, account, req.symbol, openSide);
    const afterNotional =
      (held ? notional(held.qty, markPrice) : 0n) +
      pendingOpenNotional(state, account, req.symbol, openSide) +
      cost.notional;

    const lastBracket = brackets[brackets.length - 1]!;
    if (afterNotional > lastBracket.notionalCap) {
      return reject(
        "LEVERAGE_TOO_HIGH",
        `成交后名义价值 ${show(afterNotional)} USDT 超出 ${req.symbol} 最大可持仓名义价值 ${show(lastBracket.notionalCap)} USDT`,
      );
    }
    const bracket = findBracket(brackets, afterNotional);
    if (leverageNum > bracket.maxLeverageNum) {
      return reject(
        "LEVERAGE_TOO_HIGH",
        `当前杠杆 ${leverageNum}x 下，${req.symbol} 最大可开名义价值 ${show(maxNotionalFor(brackets, leverageNum))} USDT；` +
          `本单成交后将达到 ${show(afterNotional)} USDT，该档位最高 ${bracket.maxLeverageNum}x，请调低杠杆或减少数量`,
      );
    }

    // ⑩ 可用余额 ≥ 起始保证金 + 预留 Taker 手续费
    requiredMargin =
      req.type === "MARKET"
        ? divRound(cost.notional, BigInt(leverageNum) * SCALE) + cost.fee
        : frozenMargin(
            { reduceOnly: false, closePosition: false, qty: openQty, price: req.price!, leverageNum },
            state.config.fees.takerFeeRate,
          );
    const available = accountAvailable(state, account);
    if (typeof available === "string") {
      return reject("MARKET_NOT_READY", `缺少 ${available} 的标记价，暂时无法计算可用余额`);
    }
    if (available < requiredMargin) {
      return reject(
        "INSUFFICIENT_MARGIN",
        `可用余额 ${show(available)} USDT 不足，本单需要 ${show(requiredMargin)} USDT（${leverageNum}x 起始保证金 + 预留手续费）`,
      );
    }
  }

  // ⑪ 市价单数量 ≤ 对手方可见深度 × 50%（对齐 stepSize 向下取，提示里的数字就是真能下的量）
  if (req.type === "MARKET") {
    const depth = oppositeLevels.reduce((sum, level) => sum + level.qty, 0n);
    const maxQty = alignQty(mul(depth, state.config.limits.marketDepthRatio), spec.marketStepSize);
    if (qty > maxQty) {
      return reject(
        "MARKET_ORDER_TOO_LARGE",
        `当前深度下最大可市价成交 ${show(maxQty)} ${base}，请减小数量或用限价单`,
      );
    }
  }

  // ⑫ GTX（只做 Maker）：下单瞬间就会和对手盘成交的，拒掉
  //    触发单的 GTX 要到触发时才知道会不会吃单，那时候转 EXPIRED（第 09 讲）
  if (req.type === "LIMIT" && req.timeInForce === "GTX") {
    const price = req.price!;
    const best = oppositeLevels[0]!.price;
    const crosses = req.side === "BUY" ? price >= best : price <= best;
    if (crosses) {
      return reject(
        "POST_ONLY_REJECTED",
        `只做 Maker 的订单会立刻成交：委托价 ${show(price)}，对手方最优价 ${show(best)}`,
      );
    }
  }

  // ⑬ 挂单数上限（币安 MAX_NUM_ORDERS）：**每个币对**分别计数，普通挂单和触发单一起算，BTCUSDT 上限 200。
  //    只有"会留在挂单簿里"的订单才受限——市价、IOC、FOK 下完就结束，不占挂单位；
  //    要是它们也被拦，挂满的用户连市价平仓都做不了（币安文档没写这一点，是我们的判断）
  const timeInForce = req.timeInForce ?? "GTC";
  const rests = isTrigger || (req.type === "LIMIT" && (timeInForce === "GTC" || timeInForce === "GTX"));
  if (rests) {
    const maxOrders = spec.maxNumOrdersNum;
    const openOrders = countOpenOrders(state, accountId, req.symbol);
    if (openOrders >= maxOrders) {
      return reject(
        "TOO_MANY_ORDERS",
        `${req.symbol} 上已有 ${openOrders} 张挂单，达到该币对上限 ${maxOrders} 张，请先撤掉一些`,
      );
    }
  }

  return {
    ok: true,
    order: {
      spec,
      timeInForce,
      workingType: req.workingType ?? "CONTRACT_PRICE",
      qty,
      reduceOnly,
      closePosition,
      openSide,
      closeSide,
      closeQty,
      openQty,
      leverageNum,
      marginMode: setting.marginMode,
      requiredMargin,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 第 3 步：参数组合
// ─────────────────────────────────────────────────────────────

/**
 * 返回第一条不合法的原因；合法返回 null。只看请求本身和持仓模式，不看仓位和行情。
 * 规则对照币安 New Order / New Algo Order 接口的参数说明；多传了不需要的参数，
 * 币安报 -1106 PARAM_NOT_REQUIRED，我们同样拒。
 */
function checkParams(req: PlaceOrderRequest, positionMode: PositionMode): string | null {
  const isTrigger = TRIGGER_TYPES.includes(req.type);
  const isPriced = PRICED_TYPES.includes(req.type);

  if (isPriced && req.price === undefined) return `${req.type} 单必须填委托价 price`;
  if (!isPriced && req.price !== undefined) return `${req.type} 单不接受委托价 price`;
  if (req.price !== undefined && req.price <= 0n) return "委托价必须大于 0";

  if (isTrigger && req.stopPrice === undefined) return `${req.type} 单必须填触发价 stopPrice`;
  if (!isTrigger && req.stopPrice !== undefined) return `${req.type} 单不接受触发价 stopPrice`;
  if (req.stopPrice !== undefined && req.stopPrice <= 0n) return "触发价必须大于 0";

  // TIF 描述的是"挂到盘口上之后怎么处理"，市价类订单不挂盘口，传了说明调用方理解错了
  if (!isPriced && req.timeInForce !== undefined) return `${req.type} 单不接受 timeInForce`;
  if (!isTrigger && req.workingType !== undefined) return "只有触发单才能指定 workingType";

  if (positionMode === "HEDGE") {
    // 币安："reduceOnly — Cannot be sent in Hedge Mode"。双向模式下 SELL + LONG、BUY + SHORT 本身就是减仓，
    // 不需要这个开关；传 false 也算传了（-1106），宿主不要默认塞 reduceOnly: false
    if (req.reduceOnly !== undefined) {
      return "双向持仓模式下不能传 reduceOnly：SELL + LONG（平多）、BUY + SHORT（平空）本身就是减仓";
    }
    // 币安："In Hedge Mode, cannot be used with BUY orders in LONG position side, and SELL orders in SHORT position side"
    const opening =
      (req.side === "BUY" && req.positionSide === "LONG") || (req.side === "SELL" && req.positionSide === "SHORT");
    if (req.closePosition && opening) {
      return `双向持仓模式下 ${req.side} + ${req.positionSide} 是开仓方向，不能用 closePosition`;
    }
  }

  if (req.closePosition) {
    if (!CLOSE_POSITION_TYPES.includes(req.type)) {
      return "closePosition 只能用于 STOP_MARKET / TAKE_PROFIT_MARKET";
    }
    if (req.reduceOnly) return "closePosition 已经隐含只减仓，不要同时设置 reduceOnly";
    if (req.qty !== undefined) return "closePosition 单在触发时按全部仓位平仓，不要填数量 qty";
    return null;
  }

  if (req.qty === undefined) return "必须填数量 qty";
  if (req.qty <= 0n) return "数量必须大于 0";
  return null;
}

// ─────────────────────────────────────────────────────────────
// 查询与估算
// ─────────────────────────────────────────────────────────────

/**
 * 这张单的参考价，用于第 6 步的最小名义价值：
 * 限价类用委托价，市价触发单用触发价，市价单用对手方最优价。
 */
function referencePrice(req: PlaceOrderRequest, book: { bids: Level[]; asks: Level[] }): Fixed {
  if (req.price !== undefined) return req.price;
  if (req.stopPrice !== undefined) return req.stopPrice;
  return (req.side === "BUY" ? book.asks : book.bids)[0]!.price;
}

/**
 * 市价单逐档估算：先跳过 skipQty（被平仓部分吃掉的档位），再吃 takeQty，
 * 返回吃到的名义价值之和、按 Taker 费率逐档向上取整的手续费之和。
 *
 * 和第 05 讲真正成交的算法走的是同一条路径，所以估出来的就是会成交的价格，不是标记价。
 * 深度不够的部分按最深一档的价格估——这种单一定会在第 11 步被拒，这里只要别算崩。
 */
function walkBook(levels: readonly Level[], skipQty: Fixed, takeQty: Fixed, takerFeeRate: Fixed) {
  let skip = skipQty;
  let remaining = takeQty;
  let notionalSum = 0n;
  let feeSum = 0n;

  const take = (price: Fixed, qty: Fixed) => {
    const value = notional(qty, price);
    notionalSum += value;
    feeSum += mulCeil(value, takerFeeRate);
    remaining -= qty;
  };

  for (const level of levels) {
    if (remaining === 0n) break;
    let available = level.qty;
    if (skip > 0n) {
      const skipped = skip < available ? skip : available;
      skip -= skipped;
      available -= skipped;
    }
    if (available > 0n) take(level.price, remaining < available ? remaining : available);
  }
  if (remaining > 0n) take(levels[levels.length - 1]!.price, remaining);

  return { notional: notionalSum, fee: feeSum };
}

/** 某个方向上 qty > 0 的仓位。单向模式下 LONG 和 SHORT 最多只能有一个。 */
function activePosition(
  state: EngineState,
  account: Account,
  symbol: string,
  direction: Direction,
): Readonly<Position> | undefined {
  const position = state.positions.get(positionKey(account.id, symbol, direction));
  if (account.positionMode === "ONE_WAY" && position && position.qty > 0n) {
    const other = state.positions.get(positionKey(account.id, symbol, opposite(direction)));
    if (other && other.qty > 0n) {
      throw new Error(`单向持仓模式的账户 ${account.id} 在 ${symbol} 上同时持有多空两个仓位，状态已损坏`);
    }
  }
  return position && position.qty > 0n ? position : undefined;
}

/**
 * 同一方向上其它"会开仓"的挂单还没成交的名义价值（按各自委托价）。
 * 不算进来的话，用户拆成 10 张小单就能绕过杠杆分层——每张都不跨层，全成交后早就跨了。
 * 不算：只减仓 / 全部平仓单（不会加仓）、还没触发的触发单（触发时再校验）。
 */
function pendingOpenNotional(state: EngineState, account: Account, symbol: string, direction: Direction): Fixed {
  let sum = 0n;
  for (const order of state.orders.values()) {
    if (order.accountId !== account.id || order.symbol !== symbol) continue;
    if (order.reduceOnly || order.closePosition || order.price === null) continue;
    if (TRIGGER_TYPES.includes(order.type) && !order.triggered) continue;
    const orderDirection: Direction =
      account.positionMode === "HEDGE" ? (order.positionSide as Direction) : order.side === "BUY" ? "LONG" : "SHORT";
    if (orderDirection !== direction) continue;
    sum += notional(order.qty - order.executedQty, order.price);
  }
  return sum;
}

/**
 * 04-backend-design.md 4.2 节的可用余额，对整个账户现算。
 * 全仓仓位要用标记价算浮盈浮亏；某个币对缺标记价时返回那个币对的名字——
 * 算不出来就说算不出来，不拿 0 顶替。
 *
 * 性能备注：这里遍历全部仓位和订单，和账户总数成正比。账户多了之后第 11 讲宿主
 * 应该给引擎加"按账户索引"，现在先保证算对。
 */
function accountAvailable(state: EngineState, account: Account): Fixed | string {
  let crossUnrealizedPnlSum = 0n;
  let crossInitialMarginSum = 0n;
  let isolatedMarginSum = 0n;

  for (const position of state.positions.values()) {
    if (position.accountId !== account.id || position.qty === 0n) continue;
    if (position.marginMode === "ISOLATED") {
      isolatedMarginSum += position.isolatedMargin;
      continue;
    }
    const mark = state.marks.get(position.symbol);
    if (!mark) return position.symbol;
    crossUnrealizedPnlSum += unrealizedPnl(position, mark.markPrice);
    crossInitialMarginSum += initialMargin(position.qty, position.entryPrice, position.leverageNum);
  }

  let frozenMarginSum = 0n;
  for (const order of state.orders.values()) {
    if (order.accountId === account.id) frozenMarginSum += order.frozenMargin;
  }

  return availableBalance({
    walletBalance: account.walletBalance,
    crossUnrealizedPnlSum,
    crossInitialMarginSum,
    isolatedMarginSum,
    frozenMarginSum,
  });
}

/**
 * 给定杠杆下最多能开多大的名义价值：所有允许这个杠杆的档位里，上限最高的那一档。
 * 分层表按上限升序、最大杠杆逐层递减，所以从前往后找到最后一个允许的档位即可。
 */
export function maxNotionalFor(brackets: readonly { notionalCap: Fixed; maxLeverageNum: number }[], leverageNum: number): Fixed {
  let cap = 0n;
  for (const bracket of brackets) {
    if (bracket.maxLeverageNum >= leverageNum) cap = bracket.notionalCap;
  }
  return cap;
}

function countOpenOrders(state: EngineState, accountId: string, symbol: string): number {
  let count = 0;
  for (const order of state.orders.values()) {
    if (order.accountId === accountId && order.symbol === symbol) count++;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────

function reject(code: ErrorCode, message: string): OrderValidation {
  return { ok: false, code, message };
}

function opposite(direction: Direction): Direction {
  return direction === "LONG" ? "SHORT" : "LONG";
}

function directionName(direction: Direction): string {
  return direction === "LONG" ? "多头" : "空头";
}

/** BTCUSDT → BTC。提示里写"最大可成交 3.5 BTC"比写"3.5"好懂。 */
function baseAsset(symbol: string): string {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

/** 给用户看的数字：完整 8 位精度，去掉末尾多余的 0。"50000.00000000" → "50000"。 */
function show(value: Fixed): string {
  return format(value).replace(/\.?0+$/, "");
}
