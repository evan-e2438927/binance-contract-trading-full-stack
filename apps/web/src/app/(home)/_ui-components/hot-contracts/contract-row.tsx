"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CoinIcon } from "@/components/coin-icon";
import { DirectionText } from "@/components/direction-text";
import { formatCompact, formatPercentValue, formatPrice, formatRatioAsPercent } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

import { CONTRACT_GRID } from "./grid";

/**
 * 热门合约的一行（Figma 2:141）。只订阅自己这个币对的 ticker，一条推送只重渲染一行。
 * 只有 24h 涨跌按涨跌着色（用户 2026-09-19 定，和设计稿不同：设计稿里最新价、资金费率、头像也着色）；
 * 其余数值列（最新价、标记价、资金费率、成交额）都是白色。
 */
export function ContractRow({ spec }: { spec: SymbolSpec }) {
  const router = useRouter();
  const ticker = useMarketStore((s) => s.tickers[spec.symbol]);
  const change = ticker?.stats24h?.priceChangePercent;
  const quoteVolume = ticker?.stats24h?.quoteVolume;
  const href = `/trade/${spec.symbol}` as const;

  return (
    // biome-ignore lint/a11y/useSemanticElements: 行里还有一个「交易」Link，整行不能再包成 <a>（a 不能嵌套 a）
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      className={cn(
        CONTRACT_GRID,
        "num cursor-pointer border-b py-3 transition-colors last:border-b-0 hover:bg-elevated",
      )}
    >
      <div className="flex items-center gap-2.5">
        <CoinIcon asset={spec.baseAsset} />
        <div>
          <div className="font-semibold text-[13px] text-foreground leading-[19.5px]">
            {spec.baseAsset}/{spec.quoteAsset}
          </div>
          <div className="text-[11px] text-muted-foreground leading-[16.5px]">永续</div>
        </div>
      </div>
      <span className="text-right font-mono font-semibold text-[13px] text-foreground leading-[19.5px]">
        {formatPrice(ticker?.lastPrice, spec)}
      </span>
      <DirectionText value={change} className="text-right font-medium font-mono text-[12px] leading-[18px]">
        {formatPercentValue(change)}
      </DirectionText>
      <span className="text-right font-mono text-[12px] text-foreground leading-[18px]">
        {formatPrice(ticker?.markPrice, spec)}
      </span>
      <span className="text-right font-mono text-[12px] text-foreground leading-[18px]">
        {formatRatioAsPercent(ticker?.fundingRate, { precision: 4 })}
      </span>
      <span
        className="text-right font-mono text-[12px] text-foreground leading-[18px]"
        title={quoteVolume ?? undefined}
      >
        {quoteVolume ? `${formatCompact(quoteVolume)} USDT` : formatCompact(quoteVolume)}
      </span>
      <div className="flex justify-center">
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="rounded-[5px] bg-brand px-3.5 py-[5px] font-bold text-[12px] text-black leading-[18px] transition-colors hover:bg-brand/80"
        >
          交易
        </Link>
      </div>
    </div>
  );
}
