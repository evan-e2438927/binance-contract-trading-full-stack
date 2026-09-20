import {
  accounts,
  accountSymbolSettings,
  fills,
  fundingPayments,
  identities,
  ledgerEntries,
  liquidations,
  orders,
  positions,
  type DbExecutor,
} from "@binance-contract-trading-full-stack/db";
import type { EngineEvent } from "@binance-contract-trading-full-stack/engine";
import type { AuthProvider, PositionMode } from "@binance-contract-trading-full-stack/shared";
import { eq, sql } from "drizzle-orm";
import { toDbId } from "./ids";
import { toDbPosition, toDbPositionSide } from "./positions";

/**
 * 一次 apply 产生的全部事件，**一个事务**写进数据库（02-architecture.md 第七节"落库时机"）。
 *
 * 事务要么全成要么全不成；抛错时宿主调 engine.rollback()，内存退回 apply 之前，和数据库保持一致。
 *
 * 和设计文档的一处不同：设计把"纯挂单变化（下单成功、撤单）"放进异步批量写。我们第一版**全部同步写**——
 * 实际跑下来会产生事件的输入并不多（盘口推送、大部分行情成交推送、标记价推送都是 0 个事件，不落库），
 * 同步写换来的是"引擎内存 == 数据库"始终成立，kill -9 之后什么都不丢（缺口 #32）。
 *
 * 事件按引擎给的顺序逐条写：引擎保证 orderUpdate 在它的 fill 之前（fills.order_id 外键）。
 */

export interface PersistContext {
  /** 账户当前的持仓模式：仓位 / 资金费 / 强平记录的 positionSide 和数量符号要按它转换（缺口 #12） */
  positionModeOf(accountId: string): PositionMode;
  /**
   * 正在注册的新账户（第 12 讲，engine-host/register-account.ts）：INITIAL 流水落库时，
   * 账户行、身份行、流水在**同一个事务**里写。身份撞了唯一索引（同一个身份并发首次登录）整个事务失败，
   * 宿主回滚引擎，不会留下"有钱没身份"或"有身份没发钱"的半截账户。
   */
  pendingRegistrationOf?(accountId: string): PendingRegistration | undefined;
}

export interface PendingRegistration {
  provider: AuthProvider;
  providerId: string;
  nickname: string;
  positionMode: PositionMode;
}

export async function persistEvents(db: DbExecutor, events: readonly EngineEvent[], ctx: PersistContext): Promise<void> {
  if (events.every((e) => e.t === "rejected")) return; // 被拒的请求不入库（04-backend-design.md 第 3 节状态机）
  await db.transaction(async (tx) => {
    for (const event of events) await writeEvent(tx, event, ctx);
  });
}

async function writeEvent(tx: DbExecutor, event: EngineEvent, ctx: PersistContext): Promise<void> {
  switch (event.t) {
    case "orderUpdate": {
      const o = event.order;
      const row = {
        id: toDbId(o.id),
        clientOrderId: o.clientOrderId,
        accountId: o.accountId,
        symbol: o.symbol,
        side: o.side,
        positionSide: o.positionSide,
        type: o.type,
        timeInForce: o.timeInForce,
        price: o.price,
        stopPrice: o.stopPrice,
        workingType: o.workingType,
        qty: o.qty,
        executedQty: o.executedQty,
        avgPrice: o.avgPrice,
        reduceOnly: o.reduceOnly,
        closePosition: o.closePosition,
        status: o.status,
        triggered: o.triggered,
        queueAhead: o.queueAhead,
        queueEstimated: o.queueEstimated,
        frozenMargin: o.frozenMargin,
        rejectReason: o.rejectReason,
        createdAt: new Date(o.createdAt),
        updatedAt: new Date(o.updatedAt),
      };
      const { id: _id, clientOrderId: _c, accountId: _a, createdAt: _t, ...mutable } = row;
      await tx.insert(orders).values(row).onConflictDoUpdate({ target: orders.id, set: mutable });
      return;
    }
    case "fill": {
      const f = event.fill;
      await tx.insert(fills).values({
        id: toDbId(f.id),
        orderId: toDbId(f.orderId),
        accountId: f.accountId,
        symbol: f.symbol,
        side: f.side,
        positionSide: f.positionSide,
        price: f.price,
        qty: f.qty,
        role: f.role,
        fee: f.fee,
        realizedPnl: f.realizedPnl,
        isLiquidation: f.isLiquidation,
        createdAt: new Date(f.ts),
      });
      return;
    }
    case "positionUpdate": {
      const p = event.position;
      const { positionSide, positionAmt } = toDbPosition(ctx.positionModeOf(p.accountId), p.positionSide, p.qty);
      const row = {
        accountId: p.accountId,
        symbol: p.symbol,
        positionSide,
        marginMode: p.marginMode,
        leverage: p.leverageNum,
        positionAmt,
        entryPrice: p.entryPrice,
        isolatedMargin: p.isolatedMargin,
        costBasis: p.costBasis,
        openedAt: new Date(p.openedAt),
        updatedAt: new Date(p.updatedAt),
      };
      await tx
        .insert(positions)
        .values(row)
        .onConflictDoUpdate({
          target: [positions.accountId, positions.symbol, positions.positionSide],
          set: {
            marginMode: row.marginMode,
            leverage: row.leverage,
            positionAmt: row.positionAmt,
            entryPrice: row.entryPrice,
            isolatedMargin: row.isolatedMargin,
            costBasis: row.costBasis,
            openedAt: row.openedAt,
            updatedAt: row.updatedAt,
          },
        });
      return;
    }
    case "settingUpdate": {
      const s = event.setting;
      await tx
        .insert(accountSymbolSettings)
        .values({ accountId: s.accountId, symbol: s.symbol, leverage: s.leverageNum, marginMode: s.marginMode })
        .onConflictDoUpdate({
          target: [accountSymbolSettings.accountId, accountSymbolSettings.symbol],
          set: { leverage: s.leverageNum, marginMode: s.marginMode, updatedAt: sql`now()` },
        });
      return;
    }
    case "positionModeUpdate":
      await tx.update(accounts).set({ positionMode: event.positionMode }).where(eq(accounts.id, event.accountId));
      return;
    case "balanceUpdate": {
      const registration = event.reason === "INITIAL" ? ctx.pendingRegistrationOf?.(event.accountId) : undefined;
      if (registration) {
        // 先建账户行（余额 0，下面和其它流水一样更新成 balanceAfter），再挂身份，流水的外键才有着落
        await tx.insert(accounts).values({
          id: event.accountId,
          positionMode: registration.positionMode,
          nickname: registration.nickname,
          createdAt: new Date(event.ts),
          lastSeenAt: new Date(event.ts),
        });
        await tx.insert(identities).values({
          accountId: event.accountId,
          provider: registration.provider,
          providerId: registration.providerId,
          createdAt: new Date(event.ts),
        });
      }
      await tx.insert(ledgerEntries).values({
        accountId: event.accountId,
        type: event.reason,
        symbol: event.symbol,
        amount: event.delta,
        balanceAfter: event.walletBalance,
        refType: event.ref?.type ?? null,
        refId: event.ref ? toDbId(event.ref.id) : null,
        createdAt: new Date(event.ts),
      });
      const updated = await tx
        .update(accounts)
        .set({
          walletBalance: event.walletBalance,
          ...(event.reason === "RESET" ? { lastResetAt: new Date(event.ts) } : {}),
        })
        .where(eq(accounts.id, event.accountId))
        .returning({ id: accounts.id });
      // 账户行要么是上面刚建的，要么早就在库里。没有这一行说明接线错了（注册没走 register-account.ts），不能让流水悬空
      if (updated.length === 0) throw new Error(`balanceUpdate 找不到账户 ${event.accountId}`);
      return;
    }
    case "liquidation": {
      const r = event.record;
      await tx.insert(liquidations).values({
        id: toDbId(r.id),
        accountId: r.accountId,
        symbol: r.symbol,
        positionSide: toDbPositionSide(ctx.positionModeOf(r.accountId), r.positionSide),
        marginMode: r.marginMode,
        qty: r.qty,
        entryPrice: r.entryPrice,
        markPrice: r.markPrice,
        realizedPnl: r.realizedPnl,
        liquidationFee: r.liquidationFee,
        marginBalanceBefore: r.marginBalanceBefore,
        maintMarginAt: r.maintMarginAt,
        createdAt: new Date(r.ts),
      });
      return;
    }
    case "fundingPaid": {
      const p = event.payment;
      await tx.insert(fundingPayments).values({
        id: toDbId(p.id),
        accountId: p.accountId,
        symbol: p.symbol,
        positionSide: toDbPositionSide(ctx.positionModeOf(p.accountId), p.positionSide),
        fundingRate: p.fundingRate,
        markPrice: p.markPrice,
        notional: p.notional,
        amount: p.amount,
        settledAt: new Date(p.ts),
      });
      return;
    }
    case "rejected":
      return;
    default: {
      const never: never = event;
      throw new Error(`未知的引擎事件：${JSON.stringify(never)}`);
    }
  }
}
