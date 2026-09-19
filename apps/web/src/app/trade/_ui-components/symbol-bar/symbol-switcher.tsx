"use client";

import { Input } from "@binance-contract-trading-full-stack/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@binance-contract-trading-full-stack/ui/components/popover";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CoinIcon } from "@/components/coin-icon";
import { DirectionText } from "@/components/direction-text";
import { useTickers } from "@/hooks/use-symbol-market";
import { useSymbols } from "@/hooks/use-symbols";
import { formatPercentValue, formatPrice } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

import { filterSymbols } from "./filter-symbols";

/**
 * T-01 币对切换（触发器 Figma 4:4649；下拉稿子没画，按 08 T-01：搜索 + 列表带最新价和 24h 涨跌）。
 * 切换只换路由参数（router.push），不整页刷新。
 */
export function SymbolSwitcher({ spec }: { spec: SymbolSpec }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex shrink-0 items-center gap-2 rounded-[5px] px-2 py-1 transition-colors hover:bg-elevated data-popup-open:bg-elevated">
        <span className="font-bold text-[15px] text-foreground leading-[22.5px]">
          {spec.baseAsset}/{spec.quoteAsset}
        </span>
        <span className="text-[11px] text-muted-foreground leading-[16.5px]">永续</span>
        <ChevronDownIcon className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] gap-0 border bg-elevated p-0 ring-0">
        {/* 只在打开时挂载：关着的时候不订其它 18 个币对的 ticker */}
        {open && <SwitcherList current={spec.symbol} onPicked={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function SwitcherList({ current, onPicked }: { current: string; onPicked: () => void }) {
  const router = useRouter();
  const { data: symbols = [] } = useSymbols();
  const [query, setQuery] = useState("");
  const all = useMemo(() => symbols.map((s) => s.symbol), [symbols]);
  useTickers(all);

  const list = filterSymbols(symbols, query);
  const pick = (symbol: string) => {
    onPicked();
    if (symbol !== current) router.push(`/trade/${symbol}`);
  };

  return (
    <div className="flex flex-col">
      <div className="relative border-b p-2">
        <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-4 size-3.5 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = list[0];
            if (e.key === "Enter" && first) pick(first.symbol);
          }}
          placeholder="搜索币种"
          className="h-8 bg-surface pl-7 text-[12px]"
        />
      </div>
      <div className="grid grid-cols-[1fr_auto_72px] gap-x-3 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>合约</span>
        <span className="text-right">最新价</span>
        <span className="text-right">24h涨跌</span>
      </div>
      <div className="max-h-[360px] overflow-y-auto pb-1">
        {list.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">没有匹配的币对</p>
        ) : (
          list.map((s) => <SwitcherRow key={s.symbol} spec={s} active={s.symbol === current} onPick={pick} />)
        )}
      </div>
    </div>
  );
}

function SwitcherRow({
  spec,
  active,
  onPick,
}: {
  spec: SymbolSpec;
  active: boolean;
  onPick: (symbol: string) => void;
}) {
  const lastPrice = useMarketStore((s) => s.tickers[spec.symbol]?.lastPrice);
  const change = useMarketStore((s) => s.tickers[spec.symbol]?.stats24h?.priceChangePercent);

  return (
    <button
      type="button"
      onClick={() => onPick(spec.symbol)}
      className={cn(
        "num grid w-full grid-cols-[1fr_auto_72px] items-center gap-x-3 px-3 py-1.5 text-left transition-colors hover:bg-surface",
        active && "bg-surface",
      )}
    >
      <span className="flex items-center gap-2">
        <CoinIcon asset={spec.baseAsset} className="size-5" />
        <span className="font-semibold text-[12px] text-foreground">
          {spec.baseAsset}/{spec.quoteAsset}
        </span>
        {spec.maxLeverage !== null && (
          <span className="rounded-[3px] bg-surface px-1 text-[10px] text-muted-foreground">{spec.maxLeverage}x</span>
        )}
      </span>
      <span className="text-right font-mono text-[12px] text-foreground">{formatPrice(lastPrice, spec)}</span>
      <DirectionText value={change} className="text-right font-mono text-[12px]">
        {formatPercentValue(change)}
      </DirectionText>
    </button>
  );
}
