"use client";

import Link from "next/link";

import { ModulePlaceholder } from "@/components/module-placeholder";
import { useSymbolMarket } from "@/hooks/use-symbol-market";
import { useSymbols } from "@/hooks/use-symbols";
import { DEFAULT_SYMBOL } from "@/lib/config/constants";
import { formatPrice, formatQty } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

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
    <div className="grid h-full min-h-[760px] grid-cols-[minmax(0,1fr)_320px_360px] grid-rows-[48px_minmax(0,1fr)_minmax(0,1fr)_320px] gap-px bg-border">
      <div className="col-span-3">
        <SymbolBar key={spec.symbol} spec={spec} />
      </div>
      <ModulePlaceholder
        id="T-03"
        name="K 线图"
        note="TradingView Charting Library：周期切换、指标、图上画开仓线 / 强平线 / 挂单线"
        className="row-span-2"
      />
      <ModulePlaceholder id="T-04" name="盘口" note="卖 20 档 · 最新价 / 标记价 · 买 20 档；精度切换" />
      <ModulePlaceholder
        id="T-06"
        name="下单面板"
        note="保证金模式 · 杠杆 · 限价 / 市价 / 止盈止损 · 价格 / 数量 · 百分比滑块 · 只减仓 / TIF · 预估成本 · 买入做多 / 卖出做空"
        className="row-span-2"
      />
      <ModulePlaceholder id="T-05" name="最新成交" note="价格 · 数量 · 时间，最近 50 条" />
      <ModulePlaceholder
        id="T-07"
        name="仓位 / 委托表格区"
        note="仓位（含一键平仓、调整保证金）· 当前委托（含前方排队、撤单）· 历史委托 · 成交"
        className="col-span-2"
      />
      <ModulePlaceholder id="T-08" name="账户概览" note="保证金率 · 维持保证金 · 保证金余额 · 钱包余额 · 未实现盈亏" />
      <LiveProbe spec={spec} />
    </div>
  );
}

/** 骨架阶段的链路自检：右下角浮一个小条，显示 store 里收到的实时数据。第 2 阶段删掉 */
function LiveProbe({ spec }: { spec: SymbolSpec }) {
  const book = useMarketStore((s) => s.books[spec.symbol]);
  const lastTrade = useMarketStore((s) => s.trades[spec.symbol]?.[0]);
  const ticker = useMarketStore((s) => s.tickers[spec.symbol]);

  return (
    <div className="num fixed right-4 bottom-4 z-40 border bg-popover px-3 py-2 text-muted-foreground text-xs shadow-lg">
      <div>
        盘口 买一 <span className="text-up">{formatPrice(book?.bids[0]?.[0], spec)}</span> / 卖一{" "}
        <span className="text-down">{formatPrice(book?.asks[0]?.[0], spec)}</span>
      </div>
      <div>
        成交 {formatPrice(lastTrade?.price, spec)} × {formatQty(lastTrade?.qty, spec)}
      </div>
      <div>标记价 {formatPrice(ticker?.markPrice, spec)}</div>
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
