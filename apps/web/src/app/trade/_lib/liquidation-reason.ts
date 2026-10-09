import type { Position } from "@/server-api-module/position/types";

/**
 * 持仓表「强平价」列显示 `--` 时的具体原因 → tooltip 文案。
 *
 * `reason === null`（有强平价，或者调用方还没接上新字段前的旧数据）时不显示 title，
 * 避免遮挡数值可读性——这是 002 号迭代已有行为，这里延续不能破坏。
 *
 * 非 null 的四个枚举值里，`MARK_PRICE_MISSING` 额外接一份账户级 `missingMarkPrices`
 * 点名具体缺失哪些币对；剩下三个（含理论上不可达的 `NO_LEGS`）用固定文案。
 *
 * 用 `Record<非 null 枚举值, string>` 做穷尽性检查：以后 `Position["liquidationUnavailableReason"]`
 * 新增枚举值而这里漏写，TS 编译期就会报错。
 */

type NonNullReason = Exclude<Position["liquidationUnavailableReason"], null>;

const MARGIN_SUFFICIENT_TEXT = "保证金相对仓位过于充足，价格跌到 0 也不会触发强平，算不出强平价";
const HEDGE_OFFSET_TEXT = "双向持仓下，这个币对的多空仓位数量接近对冲，理论上不会被强平，暂时算不出一个具体价格";
const MARK_PRICE_MISSING_BASE_TEXT = "全仓模式下，账户里还有其它币对没收到标记价，算不出全仓强平价";
// NO_LEGS 理论上不可达（views.ts/preview.ts 的调用路径都先过滤了 qty > 0 才会走到这个分支），
// 兜底和 MARGIN_SUFFICIENT 共用同一句。
const FALLBACK_TEXT = MARGIN_SUFFICIENT_TEXT;

const STATIC_REASON_TEXT: Record<NonNullReason, string> = {
  MARGIN_SUFFICIENT: MARGIN_SUFFICIENT_TEXT,
  HEDGE_OFFSET: HEDGE_OFFSET_TEXT,
  MARK_PRICE_MISSING: MARK_PRICE_MISSING_BASE_TEXT,
  NO_LEGS: FALLBACK_TEXT,
};

export function liquidationReasonTitle(
  reason: Position["liquidationUnavailableReason"],
  missingMarkPrices: string[],
): string | undefined {
  if (reason === null) return undefined;

  if (reason === "MARK_PRICE_MISSING") {
    if (missingMarkPrices.length === 0) return MARK_PRICE_MISSING_BASE_TEXT;
    return `${MARK_PRICE_MISSING_BASE_TEXT}，还缺 ${missingMarkPrices.join("、")} 的标记价`;
  }

  return STATIC_REASON_TEXT[reason] ?? FALLBACK_TEXT;
}
