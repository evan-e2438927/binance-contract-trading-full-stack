import { SCALE, divRound, mul, mulRound, type Fixed } from "@binance-contract-trading-full-stack/shared";
import type { LeverageBracket } from "./types";

/**
 * 04-backend-design.md 4.5/4.6 节：杠杆分层查找、维持保证金、保证金率、强平价。
 * 和 formulas.ts 一样不碰 EngineState——分层表、其他仓位的 TMM/UPNL 汇总，全部由调用方
 * （第 07 讲的风控扫描）算好传进来。
 */

/**
 * 按名义价值找所在层。brackets 必须已按 notionalCap 升序排好——state.ts 的 createState
 * 在装载配置时就排过序，这里不重复排序，重复排是浪费（这是热路径：每次标记价更新都要跑）。
 * notional 超出最后一层上限时兜底用最后一层，不抛错——调用方（第 04 讲下单校验链）
 * 应该在这之前就已经按"跨层杠杆超限拒单"的规则挡掉了，走到这里说明已经在最后一层里。
 */
export function findBracket(brackets: readonly LeverageBracket[], notionalValue: Fixed): LeverageBracket {
  if (brackets.length === 0) throw new Error("空的杠杆分层表，findBracket 无法工作");
  for (const bracket of brackets) {
    if (notionalValue <= bracket.notionalCap) return bracket;
  }
  return brackets[brackets.length - 1]!;
}

/**
 * 维持保证金 = 名义价值 × 维持保证金率 − 速算额。
 * 算例（BTCUSDT）：40,000 一层 160；50,000 边界两层都算出 200；200,000 二层 950；
 * 1,000,000 三层 6,950——见 01-domain-knowledge.md 第五节，种子脚本用同一条公式校验分层表连续性。
 */
export function maintMargin(notionalValue: Fixed, bracket: Pick<LeverageBracket, "mmr" | "cum">): Fixed {
  return mulRound(notionalValue, bracket.mmr) - bracket.cum;
}

/**
 * 保证金率 = 维持保证金总额 ÷ 保证金余额，达到 100%（= SCALE）触发强平。
 * marginBalance ≤ 0（已经穿仓）时直接返回 SCALE：此时无论维持保证金是多少都已经该强平，
 * 用真实除法会除以非正数甚至除以零，不如直接给一个"确定 ≥ 100%"的哨兵值。
 */
export function marginRatio(maintMarginSum: Fixed, marginBalanceValue: Fixed): Fixed {
  if (marginBalanceValue <= 0n) return SCALE;
  return divRound(maintMarginSum, marginBalanceValue);
}

/** 强平价公式里的一条腿：这个币对上的一个仓位（单向模式一条；双向全仓时多、空两条一起算）。 */
export interface LiquidationLeg {
  side: "LONG" | "SHORT";
  qty: Fixed; // 非负
  entryPrice: Fixed;
}

export interface LiquidationPriceInput {
  /**
   * WB。全仓：全仓钱包余额 crossWalletBalance（钱包余额 − 逐仓保证金，缺口 #6）；
   * 逐仓：这个仓位自己的逐仓保证金。
   */
  walletBalance: Fixed;
  /** TMM₁：其它币对全仓仓位的维持保证金之和（按各自标记价）。逐仓传 0。 */
  otherMaintMarginSum: Fixed;
  /** UPNL₁：其它币对全仓仓位的未实现盈亏之和（按各自标记价）。逐仓传 0。 */
  otherUnrealizedPnlSum: Fixed;
  /** 本币对参与计算的仓位。全仓双向模式把多、空两条都传进来；逐仓每个仓位单独算，只传一条。 */
  legs: readonly LiquidationLeg[];
  /** 本币对的分层表（按 notionalCap 升序）：每条腿按"强平价处的名义价值"选层 */
  brackets: readonly LeverageBracket[];
}

/**
 * 强平价，按币安 FAQ「How to Calculate Liquidation Price of USDⓈ-M Futures Contracts」（2026-09-17 核对，页面更新于 2025-12-31）：
 *
 *   强平价 = (WB − TMM₁ + UPNL₁ + cumB + cumL + cumS − Side_B×Pos_B×EP_B − Pos_L×EP_L + Pos_S×EP_S)
 *          ÷ (Pos_B×MMR_B + Pos_L×MMR_L + Pos_S×MMR_S − Side_B×Pos_B − Pos_L + Pos_S)
 *
 * 写成"腿"的形式就是：分子 = WB − TMM₁ + UPNL₁ + Σcum − Σ(方向×数量×开仓价)，分母 = Σ(数量×MMR) − Σ(方向×数量)，
 * 方向多头 +1、空头 −1。推导：强平价处 全仓权益 WB + UPNL₁ + Σ方向×数量×(P − 开仓价) = TMM₁ + Σ(数量×P×MMR − cum)，解出 P。
 *
 * ⚠️ 第 13 讲修正（缺口 #39）：原来的写法是 `+ cumB − cumL`，把全仓的 cum 当成减号。
 * 第 03 讲三个算例都落在 cum = 0 的第 1 层，测试没发现；拿 FAQ 的 ETH / BTC 算例一对就错了
 * （ETHUSDT 应为 1,153.26，旧写法得 1,234.91）。这个函数只用于展示，风控强平不经过它，没有影响过任何资金。
 *
 * 选层（FAQ "Note"）：假设一个档位算出强平价，如果强平价处的名义价值落在别的档，就换那一档重算。
 * 这里从开仓价处的名义价值起步，最多迭代到档位数那么多次；分层表在边界上连续（维持保证金两层相等），
 * 边界上来回跳时两种选法结果相同，取最后一次。这也顺带修了缺口 #24（算例 B 应该是第 2 层的 54,776.12）。
 *
 * 返回 null = 没有强平价：分母为 0（双向全仓多空数量对冲、价格怎么走权益都不降到维持保证金）
 * 或算出来 ≤ 0（钱包足够扛到价格归零）。币安这两种情况显示 0 / "--"，我们返回 null，不编一个数。
 *
 * 不对齐 tickSize（缺口 #5）：强平价是计算阈值，不是委托价。最后一步 divRound 四舍五入到 8 位。
 */
export function liquidationPrice(input: LiquidationPriceInput): Fixed | null {
  const legs = input.legs.filter((leg) => leg.qty > 0n);
  if (legs.length === 0) return null;

  let chosen = legs.map((leg) => findBracket(input.brackets, mul(leg.qty, leg.entryPrice)));
  let price: Fixed | null = null;
  for (let round = 0; round <= input.brackets.length; round++) {
    price = solve(input, legs, chosen);
    if (price === null) return null;
    const next = legs.map((leg) => findBracket(input.brackets, mul(leg.qty, price!)));
    if (next.every((bracket, i) => bracket === chosen[i])) break;
    chosen = next;
  }
  return price !== null && price > 0n ? price : null;
}

function solve(input: LiquidationPriceInput, legs: readonly LiquidationLeg[], brackets: readonly LeverageBracket[]): Fixed | null {
  let numerator = input.walletBalance - input.otherMaintMarginSum + input.otherUnrealizedPnlSum;
  let denominator = 0n;
  legs.forEach((leg, i) => {
    const bracket = brackets[i]!;
    const sideTerm = mul(leg.qty, leg.entryPrice);
    numerator += bracket.cum - (leg.side === "LONG" ? sideTerm : -sideTerm);
    denominator += mul(leg.qty, bracket.mmr) - (leg.side === "LONG" ? leg.qty : -leg.qty);
  });
  if (denominator === 0n) return null;
  return divRound(numerator, denominator);
}
