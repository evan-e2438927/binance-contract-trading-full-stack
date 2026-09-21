"use client";

import { useSymbols } from "@/hooks/use-symbols";
import { formatRatioAsPercent, PLACEHOLDER } from "@/lib/format/number";

/**
 * 手续费率和清算费率。
 *
 * **这几个数不写死在页面里**：费率是服务端配置、清算费率是币安按币对给的，
 * 写死一份迟早和实际收的对不上。这里从 `GET /market/symbols` 现取，
 * 取不到就显示 `--`（宁可说不知道，不编数字）。
 */
export function FeeRates() {
  const { data: symbols } = useSymbols();
  const first = symbols?.[0];

  // 清算费率按币安是按币对给的，这里归个类，不逐个列 19 行
  const byRate = new Map<string, string[]>();
  for (const spec of symbols ?? []) {
    if (!spec.liquidationFeeRate) continue;
    const list = byRate.get(spec.liquidationFeeRate) ?? [];
    list.push(spec.symbol);
    byRate.set(spec.liquidationFeeRate, list);
  }

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border bg-surface p-4 text-[13px] leading-[22px]">
      <div className="flex flex-wrap gap-x-8 gap-y-1">
        <span className="text-muted-foreground">
          挂单方（Maker）
          <span className="pl-2 font-mono text-foreground">
            {first ? formatRatioAsPercent(first.makerFeeRate, { precision: 3, signed: false }) : PLACEHOLDER}
          </span>
        </span>
        <span className="text-muted-foreground">
          吃单方（Taker）
          <span className="pl-2 font-mono text-foreground">
            {first ? formatRatioAsPercent(first.takerFeeRate, { precision: 3, signed: false }) : PLACEHOLDER}
          </span>
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        按成交价 × 数量收。全站一个费率档，不按等级分。手续费按币安规则在开仓和平仓时各收一次。
      </p>

      <div className="border-t pt-3">
        <p className="pb-1.5 text-muted-foreground">强平清算费（只在被强平时收，比普通手续费高）</p>
        {byRate.size === 0 ? (
          <p className="font-mono text-muted-foreground">{PLACEHOLDER}</p>
        ) : (
          [...byRate.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([rate, list]) => (
              <p key={rate} className="text-[12px] text-muted-foreground">
                <span className="font-mono text-foreground">
                  {formatRatioAsPercent(rate, { precision: 3, signed: false })}
                </span>
                <span className="pl-2">{list.join("、")}</span>
              </p>
            ))
        )}
      </div>
    </div>
  );
}
