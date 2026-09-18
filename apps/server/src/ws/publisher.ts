import type { Engine, EngineEvent, EngineInput } from "@binance-contract-trading-full-stack/engine";
import type { PositionMode } from "@binance-contract-trading-full-stack/shared";
import { toDecimal } from "../http/decimal";
import type { MarketEvent } from "../market/parse";
import type { FeedStatus } from "../market/market-feed";
import type { MarketState } from "../market/market-state";
import { accountJson, orderFromEngine, positionJson } from "../api/serialize";
import { MARKET_STATUS_CHANNEL, type WsHub } from "./hub";
import { closedPositionPayload, fillPayload, fundingPayload, liquidationPayload } from "./serialize";

/**
 * 把行情事件和引擎事件变成推送（04-backend-design.md 第 12 节的频道表）。
 *
 * 公共频道直接来自行情层：盘口 100ms、成交实时、K 线实时、ticker 跟着标记价推送走（币安 `@markPrice@1s` 就是 1 秒一条，
 * 正好是设计要求的频率，不用另加节流）。
 *
 * 私有频道来自引擎宿主的 `onCommitted`——**落库成功之后**才推，推出去的每一条都是已经落库的事实。
 * 一次 apply 可能产生好几条余额变动（成交 + 手续费 + 资金费），账户快照按账户去重，只在最后推一次。
 */

export interface WsPublisherOptions {
  hub: WsHub;
  /** 读账户 / 仓位视图。onCommitted 在 commit 之后、下一个输入之前调用，这时直接读引擎是安全的 */
  engine: Pick<Engine, "accountView" | "positionViews">;
  marketState: MarketState;
  positionModeOf: (accountId: string) => PositionMode;
}

export interface WsPublisher {
  onMarketEvent(event: MarketEvent): void;
  onFeedStatus(status: FeedStatus): void;
  onCommitted(input: EngineInput, events: readonly EngineEvent[]): void;
}

export function createWsPublisher(options: WsPublisherOptions): WsPublisher {
  const { hub, engine, marketState } = options;

  function pushAccount(accountId: string): void {
    const view = engine.accountView(accountId);
    if (view) hub.publishToAccount(accountId, "account", accountJson(view));
  }

  function pushPosition(accountId: string, symbol: string, positionSide: string): void {
    const mode = options.positionModeOf(accountId);
    const view = engine.positionViews(accountId).find((p) => p.symbol === symbol && p.positionSide === positionSide);
    if (view) hub.publishToAccount(accountId, "position", positionJson(mode, view));
  }

  return {
    onMarketEvent(event) {
      switch (event.t) {
        case "book":
          hub.publish(`depth:${event.symbol}`, {
            bids: event.bids.map((l) => [toDecimal(l.price), toDecimal(l.qty)]),
            asks: event.asks.map((l) => [toDecimal(l.price), toDecimal(l.qty)]),
            updateTime: event.ts,
          });
          return;
        case "trade":
          hub.publish(`trade:${event.symbol}`, {
            tradeId: event.tradeId,
            price: toDecimal(event.price),
            qty: toDecimal(event.qty),
            buyerIsMaker: event.buyerIsMaker,
            time: event.ts,
          });
          return;
        case "kline":
          hub.publish(`kline:${event.symbol}:${event.interval}`, {
            interval: event.interval,
            openTime: event.openTime,
            closeTime: event.closeTime,
            open: toDecimal(event.open),
            high: toDecimal(event.high),
            low: toDecimal(event.low),
            close: toDecimal(event.close),
            volume: toDecimal(event.volume),
            closed: event.closed,
          });
          return;
        case "markPrice": {
          // 涨跌幅要 24 小时统计，那是币安 REST 的数（第 13b 讲），不在推送里（缺口 #50）：前端首屏拉一次 /market/ticker
          const trade = marketState.lastTrade(event.symbol);
          hub.publish(`ticker:${event.symbol}`, {
            lastPrice: trade ? toDecimal(trade.price) : null,
            lastTradeTime: trade?.ts ?? null,
            markPrice: toDecimal(event.markPrice),
            indexPrice: toDecimal(event.indexPrice),
            fundingRate: toDecimal(event.fundingRate),
            nextFundingTime: event.nextFundingTs,
            markTime: event.ts,
          });
          return;
        }
      }
    },

    onFeedStatus(status) {
      hub.publish(MARKET_STATUS_CHANNEL, { status, matchingEnabled: status === "ready" });
    },

    onCommitted(_input, events) {
      const accountsToRefresh = new Set<string>();
      for (const event of events) {
        switch (event.t) {
          case "orderUpdate":
            hub.publishToAccount(event.order.accountId, "order", orderFromEngine(event.order));
            break;
          case "fill":
            hub.publishToAccount(event.fill.accountId, "fill", fillPayload(options.positionModeOf(event.fill.accountId), event.fill));
            break;
          case "positionUpdate": {
            const p = event.position;
            if (p.qty > 0n) pushPosition(p.accountId, p.symbol, p.positionSide);
            else hub.publishToAccount(p.accountId, "position", closedPositionPayload(options.positionModeOf(p.accountId), p));
            break;
          }
          case "balanceUpdate":
            accountsToRefresh.add(event.accountId);
            break;
          case "liquidation":
            hub.publishToAccount(event.record.accountId, "liquidation", liquidationPayload(options.positionModeOf(event.record.accountId), event.record));
            accountsToRefresh.add(event.record.accountId);
            break;
          case "fundingPaid":
            hub.publishToAccount(event.payment.accountId, "funding", fundingPayload(options.positionModeOf(event.payment.accountId), event.payment));
            break;
          case "settingUpdate":
            // 杠杆 / 保证金模式变了，仓位的强平价和起始保证金跟着变
            pushPosition(event.setting.accountId, event.setting.symbol, "LONG");
            pushPosition(event.setting.accountId, event.setting.symbol, "SHORT");
            accountsToRefresh.add(event.setting.accountId);
            break;
          case "positionModeUpdate":
            accountsToRefresh.add(event.accountId);
            break;
          case "rejected":
            break; // 拒单的结果在 REST 响应里，不用推
        }
      }
      for (const accountId of accountsToRefresh) pushAccount(accountId);
    },
  };
}
