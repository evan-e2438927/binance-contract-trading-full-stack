"use client";

import Link from "next/link";

import { ModulePlaceholder } from "@/components/module-placeholder";
import { useSymbolMarket } from "@/hooks/use-symbol-market";
import { useSymbols } from "@/hooks/use-symbols";
import { DEFAULT_SYMBOL } from "@/lib/config/constants";
import type { SymbolSpec } from "@/server-api-module/market/types";

import { ChartPanel } from "./chart/chart-panel";
import { OrderBook } from "./order-book/order-book";
import { RecentTrades } from "./recent-trades/recent-trades";
import { SymbolBar } from "./symbol-bar/symbol-bar";
import { usePriceTitle } from "./symbol-bar/use-price-title";

/**
 * 交易页骨架（05 第 2 节的币安式网格，桌面优先 ≥ 1280px）：
 *
 *   ┌──────────────────────────── T-01 币对切换 │ T-02 行情条 ────────────────────────────┐
 *   │ T-03 K 线图                         │ T-04 盘口       │ T-06 下单面板            │
 *   │                                     ├─────────────────┤                          │
 *   │                                     │ T-05 最新成交   ├──────────────────────────┤
 *   ├─────────────────────────────────────┴─────────────────┤ T-08 账户概览            │
 *   │ T-07 仓位 / 当前委托 / 历史委托 / 成交                  │                          │
 *   └───────────────────────────────────────────────────────┴──────────────────────────┘
 *
 * 占位块在后续阶段逐个换成真组件；编号对应 docs/design/08-frontend-pages.md。
 */
export function TradeView({ symbol }: { symbol: string }) {
  const { data: symbols, isPending } = useSymbols();
  const spec = symbols?.find((s) => s.symbol === symbol);

  if (isPending) return null;
  if (!spec) return <UnknownSymbol symbol={symbol} />;
  return <TradeLayout spec={spec} />;
}

function TradeLayout({ spec }: { spec: SymbolSpec }) {
  useSymbolMarket(spec.symbol);
  usePriceTitle(spec);

  return (
    <div className="grid h-full min-h-[760px] grid-cols-[minmax(0,1fr)_320px_360px] grid-rows-[48px_minmax(0,2fr)_minmax(0,1fr)_224px] gap-px bg-border">
      <div className="col-span-3">
        <SymbolBar key={spec.symbol} spec={spec} />
      </div>
      <div className="row-span-2 min-h-0">
        <ChartPanel spec={spec} />
      </div>
      <OrderBook spec={spec} />
      <ModulePlaceholder
        id="T-06"
        name="下单面板"
        note="保证金模式 · 杠杆 · 限价 / 市价 / 止盈止损 · 价格 / 数量 · 百分比滑块 · 只减仓 / TIF · 预估成本 · 买入做多 / 卖出做空"
        className="row-span-2"
      />
      <RecentTrades spec={spec} />
      <ModulePlaceholder
        id="T-07"
        name="仓位 / 委托表格区"
        note="仓位（含一键平仓、调整保证金）· 当前委托（含前方排队、撤单）· 历史委托 · 成交"
        className="col-span-2"
      />
      <ModulePlaceholder id="T-08" name="账户概览" note="保证金率 · 维持保证金 · 保证金余额 · 钱包余额 · 未实现盈亏" />
    </div>
  );
}

/** T-00 币对不存在或未开放 */
function UnknownSymbol({ symbol }: { symbol: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
      <p>{symbol} 不存在或未开放交易</p>
      <Link href={`/trade/${DEFAULT_SYMBOL}`} className="text-brand">
        去 {DEFAULT_SYMBOL}
      </Link>
    </div>
  );
}
