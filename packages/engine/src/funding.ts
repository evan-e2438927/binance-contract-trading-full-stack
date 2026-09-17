import { fundingFee, notional } from "./formulas";
import { putAccount, putPosition } from "./journal";
import { riskScan } from "./risk";
import { requireSymbol, sortedPositions, type EngineState } from "./state";
import type { EngineEvent, EngineInput, FundingPayment, Position } from "./types";

type InputOf<T extends EngineInput["t"]> = Extract<EngineInput, { t: T }>;

/**
 * 04-backend-design.md 第 9 节：资金费结算。依据币安 FAQ "Introduction to Binance Futures Funding Rates"（2026-03-06 更新）：
 *
 *   资金费 = 仓位名义价值 × 资金费率，名义价值 = 标记价 × 数量
 *   费率为正：多头付、空头收；为负反过来。只有结算那一刻持仓才付/收。
 *
 * 费率和标记价由宿主从币安 @markPrice 流带进来（结算那一刻的值），引擎不自己算费率、不看钟——
 * 结算时间由宿主按推送里的下次结算时间 T 排期（币安按币对设置间隔，默认 8 小时，也有 4 小时的）。
 *
 * 钱记在哪（币安用户数据流文档：资金费发生在逐仓仓位上时，ACCOUNT_UPDATE 带上那个仓位的 isolated wallet）：
 * - 全仓仓位：只改钱包余额
 * - 逐仓仓位：钱包余额和这个仓位的逐仓保证金**一起**变。逐仓保证金是钱包里锁给这个仓位的那部分（缺口 #6），
 *   资金费从这个仓位的保证金里付，所以两边同时变，全仓那部分不受影响
 *
 * 结算完立刻对付了钱的账户跑风控扫描：一笔资金费足以把高杠杆仓位推过强平线。
 */
export function settleFunding(state: EngineState, input: InputOf<"settleFunding">): EngineEvent[] {
  requireSymbol(state, input.symbol);
  const events: EngineEvent[] = [];
  const paid: string[] = [];

  for (const position of sortedPositions(state, (p) => p.symbol === input.symbol && p.qty > 0n)) {
    const amount = fundingFee(position, input.rate, input.markPrice);
    if (amount === 0n) continue; // 费率为 0，或者名义价值小到舍入后为 0：没有资金往来，不记流水
    const account = state.accounts.get(position.accountId);
    if (!account) throw new Error(`仓位 ${position.accountId}/${position.symbol} 属于不存在的账户`);

    const id = `funding:${position.accountId}:${position.symbol}:${position.positionSide}:${input.ts}`;
    const payment: FundingPayment = {
      id,
      accountId: position.accountId,
      symbol: position.symbol,
      positionSide: position.positionSide,
      fundingRate: input.rate,
      markPrice: input.markPrice,
      notional: notional(position.qty, input.markPrice),
      amount,
      ts: input.ts,
    };
    const walletBalance = account.walletBalance + amount;
    putAccount(state, { ...account, walletBalance });
    events.push({ t: "fundingPaid", payment });

    if (position.marginMode === "ISOLATED") {
      const updated: Position = { ...position, isolatedMargin: position.isolatedMargin + amount, updatedAt: input.ts };
      putPosition(state, updated);
      events.push({ t: "positionUpdate", position: updated });
    }

    events.push({
      t: "balanceUpdate",
      accountId: account.id,
      walletBalance,
      delta: amount,
      reason: "FUNDING",
      symbol: position.symbol,
      ref: { type: "funding", id },
      ts: input.ts,
    });
    paid.push(account.id);
  }

  return [...events, ...riskScan(state, paid, input.ts)];
}
