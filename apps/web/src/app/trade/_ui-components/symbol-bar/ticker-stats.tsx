"use client";

import { Countdown } from "@/components/countdown";
import { RuleLink } from "@/components/rule-link";
import { StatItem } from "@/components/stat-item";
import { formatCompact, formatDecimal, formatPrice, formatRatioAsPercent } from "@/lib/format/number";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useMarketStore } from "@/stores/market-store";

/**
 * 行情条右侧各项（Figma 4:4667～4:4702）。
 * 比设计稿多一项「24h成交额」（docs/frontend/README.md M02 要求）；24h 统计为 null 时那几项显示 "--"。
 */
export function TickerStats({ spec }: { spec: SymbolSpec }) {
  const ticker = useMarketStore((s) => s.tickers[spec.symbol]);
  const stats = ticker?.stats24h;

  return (
    <div className="flex items-center gap-5">
      <StatItem label="标记价格" hint="未实现盈亏和强平都按标记价计算，不是最新价">
        {formatPrice(ticker?.markPrice, spec)}
      </StatItem>
      <StatItem label="指数价格">{formatPrice(ticker?.indexPrice, spec)}</StatItem>
      <StatItem label="资金费率/倒计时" after={<RuleLink anchor="funding" label="资金费怎么结算" />}>
        {formatRatioAsPercent(ticker?.fundingRate, { precision: 4 })} <Countdown to={ticker?.nextFundingTime} />
      </StatItem>
      <StatItem label="24h最高">{formatPrice(stats?.highPrice, spec)}</StatItem>
      <StatItem label="24h最低">{formatPrice(stats?.lowPrice, spec)}</StatItem>
      <StatItem label="24h成交量">{stats ? `${formatDecimal(stats.volume, 0)} ${spec.baseAsset}` : "--"}</StatItem>
      <StatItem label="24h成交额(USDT)">
        <span title={stats?.quoteVolume}>{formatCompact(stats?.quoteVolume)}</span>
      </StatItem>
    </div>
  );
}
