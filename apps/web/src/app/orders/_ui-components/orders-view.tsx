"use client";

import { LEDGER_TYPE } from "@binance-contract-trading-full-stack/shared";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { useSymbols } from "@/hooks/use-symbols";
import type { LedgerType } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { LEDGER_TYPE_LABEL } from "../../_shared/labels";
import { ORDERS_TABS, type OrdersQuery, ordersHref, parseOrdersQuery, symbolOptions } from "../_lib/tabs";
import { FillsTab } from "./fills-tab";
import { FundingTab } from "./funding-tab";
import { LedgerTab } from "./ledger-tab";
import { LiquidationsTab } from "./liquidations-tab";
import { OrderHistoryTab } from "./order-history-tab";

/**
 * O-00 历史记录页：五个 tab + 筛选 + 游标分页。
 *
 * 页面状态全放 URL（`/orders?tab=fills&symbol=BTCUSDT`），不放组件 state：
 * 刷新、前进后退、把链接发给别人，看到的都是同一屏。交易页的「查看全部」也是靠这个直接跳到对应 tab。
 */
export function OrdersView() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: symbols } = useSymbols();
  const status = useAuthStore((s) => s.status);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);

  const knownSymbols = useMemo(() => symbols?.map((s) => s.symbol), [symbols]);
  const query = parseOrdersQuery(params, knownSymbols);
  const specOf = (symbol: string): SymbolSpec | undefined => symbols?.find((s) => s.symbol === symbol);

  // replace 而不是 push：换个 tab 不该在浏览器历史里堆一条，返回键要能回到上一个页面
  const go = (next: OrdersQuery) => router.replace(ordersHref(next), { scroll: false });

  const active = ORDERS_TABS.find((tab) => tab.value === query.tab) ?? ORDERS_TABS[0];

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-6 py-6">
      <h1 className="font-semibold text-[18px] text-foreground">历史记录</h1>

      <div className="flex flex-col rounded-[8px] border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2">
          <div className="flex">
            {ORDERS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => go({ ...query, tab: tab.value })}
                className={cn(
                  "border-b-2 px-3 py-3 text-[13px] transition-colors",
                  tab.value === query.tab
                    ? "border-brand font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {status === "authenticated" && (
            <div className="flex items-center gap-2 px-2 py-2">
              <Select
                label="币对"
                value={query.symbol ?? ""}
                onChange={(value) => go({ ...query, symbol: value || undefined })}
                options={[
                  { value: "", label: "全部币对" },
                  ...symbolOptions(knownSymbols ?? [], query.symbol).map((s) => ({ value: s, label: s })),
                ]}
              />
              {/* 类型筛选只有资金流水这一个 tab 有（08 第 5 节 O-03 的 8 类） */}
              {query.tab === "ledger" && (
                <Select
                  label="流水类型"
                  value={query.ledgerType ?? ""}
                  onChange={(value) => go({ ...query, ledgerType: (value || undefined) as LedgerType | undefined })}
                  options={[
                    { value: "", label: "全部类型" },
                    ...LEDGER_TYPE.map((type) => ({ value: type, label: LEDGER_TYPE_LABEL[type] })),
                  ]}
                />
              )}
            </div>
          )}
        </div>

        {status !== "authenticated" ? (
          <SignedOut onLogin={() => setLoginOpen(true)} />
        ) : (
          // key 让换 tab 时整块重挂载：上一个 tab 的滚动位置、加载了几页都不会串到下一个
          <div key={query.tab} className="min-h-[420px]">
            {query.tab === "orders" && (
              <OrderHistoryTab symbol={query.symbol} specOf={specOf} emptyText={active.empty} />
            )}
            {query.tab === "fills" && <FillsTab symbol={query.symbol} specOf={specOf} emptyText={active.empty} />}
            {query.tab === "ledger" && (
              <LedgerTab symbol={query.symbol} type={query.ledgerType} emptyText={active.empty} />
            )}
            {query.tab === "funding" && <FundingTab symbol={query.symbol} specOf={specOf} emptyText={active.empty} />}
            {query.tab === "liquidations" && (
              <LiquidationsTab symbol={query.symbol} specOf={specOf} emptyText={active.empty} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[4px] border bg-background px-2 py-1.5 text-[12px] text-muted-foreground outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** O-06 未登录：历史记录全是账户私有数据，没登录就没什么可显示的 */
function SignedOut({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
      <p className="text-[13px] text-muted-foreground">登录后查看你的委托、成交和资金记录</p>
      <button
        type="button"
        onClick={onLogin}
        className="rounded-[5px] bg-brand px-5 py-2 font-bold text-[13px] text-black"
      >
        登录 / 注册
      </button>
    </div>
  );
}
