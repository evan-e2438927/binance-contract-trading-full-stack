import { type Fixed, format, mul, parse } from "@binance-contract-trading-full-stack/shared";

import { decimalsOf, formatDecimal, fromFixed, trimDecimal } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";

import type { OrderFormValues } from "./order-body";

/**
 * 下单表单的即时校验（M07）。
 *
 * 这里只为「立刻告诉用户哪里不对」，**标准是服务端的校验链**（engine/validate-order.ts 13 步）。
 * 所以规则照着那一份写，宁可少判几条，也不要判得比服务端严——不然会出现界面拦住、其实能下的单。
 *
 * 全程 bigint。价格、数量都是字符串进、字符串出。
 */

export interface FormIssues {
  /** 价格输入框下面的红字 */
  price?: string;
  /** 触发价输入框下面的红字 */
  triggerPrice?: string;
  /** 数量输入框下面的红字 */
  qty?: string;
  /** 黄色警告：不拦，只提醒（偏离标记价太多） */
  warning?: string;
}

/** 错误文案里的数字：去掉定标的尾随零，"0.00100000" → "0.001" */
const show = (value: Fixed) => trimDecimal(format(value, 8));

/** 数量必须是 minQty + k × stepSize（LOT_SIZE，校验链第 5 步） */
export function isValidLot(qty: Fixed, lot: { minQty: Fixed; stepSize: Fixed }): boolean {
  return qty >= lot.minQty && (qty - lot.minQty) % lot.stepSize === 0n;
}

/** 向下对齐到合法数量；不足 minQty 返回 0 */
export function floorToLot(qty: Fixed, lot: { minQty: Fixed; stepSize: Fixed }): Fixed {
  if (qty < lot.minQty) return 0n;
  return lot.minQty + ((qty - lot.minQty) / lot.stepSize) * lot.stepSize;
}

/** 向下对齐到 tickSize 的整数倍（价格输入框失焦时吸附用） */
export function floorToTick(price: Fixed, tickSize: Fixed): Fixed {
  if (tickSize <= 0n) return price;
  return (price / tickSize) * tickSize;
}

/** 市价单用 MARKET_LOT_SIZE 那一组，限价类用 LOT_SIZE（校验链第 5 步） */
export function lotOf(spec: SymbolSpec, isMarket: boolean): { minQty: Fixed; stepSize: Fixed; maxQty: Fixed | null } {
  if (isMarket) {
    return {
      minQty: parse(spec.marketMinQty ?? spec.minQty),
      stepSize: parse(spec.marketStepSize ?? spec.stepSize),
      maxQty: spec.marketMaxQty ? parse(spec.marketMaxQty) : null,
    };
  }
  return {
    minQty: parse(spec.minQty),
    stepSize: parse(spec.stepSize),
    maxQty: spec.maxQty ? parse(spec.maxQty) : null,
  };
}

export interface ValidateArgs {
  values: OrderFormValues;
  spec: SymbolSpec;
  /** 标记价，用来判价格偏离；没有行情时传 null */
  markPrice: string | null;
}

export function validateOrderForm({ values, spec, markPrice }: ValidateArgs): FormIssues {
  const issues: FormIssues = {};
  const isMarket = values.tab === "MARKET" || (values.tab === "CONDITIONAL" && values.conditionalExec === "MARKET");
  const needsPrice = !isMarket;
  const lot = lotOf(spec, isMarket);
  const tickSize = parse(spec.tickSize);

  let priceFixed: Fixed | null = null;
  if (needsPrice) {
    if (!values.price.trim()) {
      issues.price = "请输入价格";
    } else {
      priceFixed = parse(values.price);
      if (priceFixed <= 0n) issues.price = "价格必须大于 0";
      else if (priceFixed % tickSize !== 0n) issues.price = `价格必须是最小变动单位 ${show(tickSize)} 的整数倍`;
      else if (spec.minPrice && priceFixed < parse(spec.minPrice))
        issues.price = `价格不能低于 ${show(parse(spec.minPrice))}`;
      else if (spec.maxPrice && priceFixed > parse(spec.maxPrice))
        issues.price = `价格不能高于 ${show(parse(spec.maxPrice))}`;
    }
  }

  if (values.tab === "CONDITIONAL") {
    if (!values.triggerPrice.trim()) {
      issues.triggerPrice = "请输入触发价";
    } else {
      const trigger = parse(values.triggerPrice);
      if (trigger <= 0n) issues.triggerPrice = "触发价必须大于 0";
      else if (trigger % tickSize !== 0n) issues.triggerPrice = `触发价必须是最小变动单位 ${show(tickSize)} 的整数倍`;
    }
  }

  if (!values.qty.trim()) {
    issues.qty = "请输入数量";
  } else {
    const qty = parse(values.qty);
    if (qty <= 0n) issues.qty = "数量必须大于 0";
    else if (qty < lot.minQty) issues.qty = `数量不能低于最小下单量 ${show(lot.minQty)}`;
    else if (lot.maxQty !== null && qty > lot.maxQty) issues.qty = `数量不能高于单笔上限 ${show(lot.maxQty)}`;
    else if (!isValidLot(qty, lot)) issues.qty = `数量必须是 ${show(lot.stepSize)} 的整数倍`;
    else {
      // 最小名义价值（校验链第 6 步）：市价单按标记价估，限价单按委托价
      const basis = priceFixed ?? (markPrice ? parse(markPrice) : null);
      if (basis !== null && mul(qty, basis) < parse(spec.minNotional)) {
        issues.qty = `下单金额不能低于 ${show(parse(spec.minNotional))} USDT`;
      }
    }
  }

  // 价格偏离标记价太多：只警告不拦（服务端 PERCENT_PRICE 才是硬规则）
  if (!issues.price && priceFixed !== null && markPrice) {
    const mark = parse(markPrice);
    const up = spec.percentPriceUp ? mul(mark, parse(spec.percentPriceUp)) : null;
    const down = spec.percentPriceDown ? mul(mark, parse(spec.percentPriceDown)) : null;
    if ((up !== null && priceFixed > up) || (down !== null && priceFixed < down)) {
      // 价格按币对精度显示（全站规则），不要把定标后的 8 位小数抖出来
      issues.warning = `委托价偏离标记价 ${formatDecimal(fromFixed(mark), decimalsOf(spec.tickSize))} 太多，这一单会被拒`;
    }
  }

  return issues;
}

/** 有没有拦住提交的问题（warning 不算） */
export function hasBlockingIssue(issues: FormIssues): boolean {
  return Boolean(issues.price || issues.triggerPrice || issues.qty);
}
