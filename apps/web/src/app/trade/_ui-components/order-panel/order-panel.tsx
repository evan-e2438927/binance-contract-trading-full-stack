"use client";

import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { Checkbox } from "@binance-contract-trading-full-stack/ui/components/checkbox";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatDecimal, formatPrice, formatUsdt, PLACEHOLDER, trimDecimal } from "@/lib/format/number";
import { notify } from "@/lib/toast/notify";
import { symbolConfigQuery } from "@/server-api-module/account/queries";
import type { TimeInForce } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { placeOrder, previewOrder } from "@/server-api-module/order/mutations";
import type { OrderPreview } from "@/server-api-module/order/types";
import { useAccountStore } from "@/stores/account-store";
import { useAuthStore } from "@/stores/auth-store";
import { useMarketStore } from "@/stores/market-store";
import { useUiStore } from "@/stores/ui-store";

import { buildPlaceOrderBody, type OrderTab } from "../../_lib/order-body";
import { estimateOrder, qtyFromPercent } from "../../_lib/order-estimate";
import { floorToTick, hasBlockingIssue, lotOf, validateOrderForm } from "../../_lib/order-validate";
import { useOrderFormStore } from "../../_stores/order-form-store";
import { LeverageDialog, MarginModeDialog, PositionModeDialog } from "../dialogs/config-dialogs";
import { ConfigButton, FieldAction, NumberField, PercentSlider } from "./fields";

/**
 * T-06 下单面板（Figma 4:5718）。
 *
 * 分工（docs/frontend/README.md 通用规则第 2 条）：
 * - 前端只算「名义价值 / 预估保证金 / 预估手续费」——它们只依赖价格、数量、杠杆、费率
 * - 「可开最大」「预估强平价」依赖账户全局状态，走 POST /orders/preview，输入停 300ms 后请求（慢半拍出现）
 * - 校验以服务端校验链为准，这里只做即时反馈
 */

const TABS: { value: OrderTab; label: string }[] = [
  { value: "LIMIT", label: "限价" },
  { value: "MARKET", label: "市价" },
  { value: "CONDITIONAL", label: "条件委托" },
];

const TIME_IN_FORCE: { value: TimeInForce; label: string }[] = [
  { value: "GTC", label: "GTC 一直有效" },
  { value: "IOC", label: "IOC 立即成交剩余取消" },
  { value: "FOK", label: "FOK 全部成交否则取消" },
  { value: "GTX", label: "GTX 只做 Maker" },
];

let orderSeqNum = 0;

export function OrderPanel({ spec }: { spec: SymbolSpec }) {
  const form = useOrderFormStore();
  const status = useAuthStore((s) => s.status);
  const loggedIn = status === "authenticated";
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);
  const matchingEnabled = useMarketStore((s) => s.matchingEnabled);
  const markPrice = useMarketStore((s) => s.tickers[spec.symbol]?.markPrice) ?? null;
  const lastPrice = useMarketStore((s) => s.tickers[spec.symbol]?.lastPrice) ?? null;
  const available = useAccountStore((s) => s.account?.availableBalance) ?? null;
  const positionMode = useAccountStore((s) => s.account?.positionMode) ?? "ONE_WAY";

  const [dialog, setDialog] = useState<"leverage" | "margin" | "position" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  // 刚进页面时不要满屏红字：「请输入…」这类空值提示等用户碰过输入框（或点过下单）再显示
  const [touched, setTouched] = useState(false);

  const { data: config } = useQuery({ ...symbolConfigQuery(spec.symbol), enabled: loggedIn });
  const leverageNum = config?.leverage ?? preview?.leverage ?? null;

  const isMarket = form.tab === "MARKET" || (form.tab === "CONDITIONAL" && form.conditionalExec === "MARKET");
  const lot = useMemo(() => lotOf(spec, isMarket), [spec, isMarket]);
  const allIssues = validateOrderForm({ values: form, spec, markPrice });
  const issues = touched ? allIssues : dropEmptyFieldHints(allIssues);
  const estimatePrice = isMarket ? markPrice : form.price || null;
  const estimate = estimateOrder({
    price: estimatePrice,
    qty: form.qty,
    leverageNum: leverageNum ?? 0,
    takerFeeRate: spec.takerFeeRate,
  });

  // 预估：输入停 300ms 后问服务端要「可开最大」和「成交后的强平价」
  const previewKey = `${spec.symbol}|${form.side}|${form.openClose}|${isMarket ? "" : form.price}|${form.qty}|${leverageNum}|${positionMode}`;
  const previewRef = useRef(previewKey);
  useEffect(() => {
    previewRef.current = previewKey;
    if (!loggedIn) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await previewOrder({
          symbol: spec.symbol,
          side: form.side,
          positionSide:
            positionMode === "ONE_WAY"
              ? "BOTH"
              : form.openClose === "OPEN"
                ? form.side === "BUY"
                  ? "LONG"
                  : "SHORT"
                : form.side === "BUY"
                  ? "SHORT"
                  : "LONG",
          price: isMarket ? undefined : form.price || undefined,
          qty: form.qty || undefined,
        });
        // 期间用户又改了输入，这次结果已经过时，丢掉
        if (previewRef.current === previewKey) setPreview(result);
      } catch {
        if (previewRef.current === previewKey) setPreview(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [previewKey, loggedIn, spec.symbol, form.side, form.openClose, form.price, form.qty, isMarket, positionMode]);

  const submit = async () => {
    setTouched(true);
    const reference = form.workingType === "MARK_PRICE" ? markPrice : lastPrice;
    const body = buildPlaceOrderBody({
      values: form,
      symbol: spec.symbol,
      positionMode,
      clientOrderId: `c-${Date.now()}-${orderSeqNum++}`,
      referencePrice: reference ? parse(reference) : null,
      triggerPriceFixed: form.triggerPrice ? parse(form.triggerPrice) : null,
    });
    if (!body) {
      notify.error(new Error("还没有行情，暂时判断不了条件单的方向"));
      return;
    }
    setSubmitting(true);
    try {
      await placeOrder(body);
      notify.success("下单成功");
      form.clearQty();
      // 订单状态、仓位、余额都等 WS 推送更新，不手动改 store
    } catch (error) {
      notify.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  const percentNum = (() => {
    if (!preview?.maxQty || !form.qty) return 0;
    const max = parse(preview.maxQty);
    if (max <= 0n) return 0;
    const ratio = Number((parse(form.qty) * 100n) / max);
    return [0, 25, 50, 75, 100].reduce(
      (best, step) => (Math.abs(step - ratio) < Math.abs(best - ratio) ? step : best),
      0,
    );
  })();

  const blocked = hasBlockingIssue(allIssues);
  const buy = form.side === "BUY";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface p-3.5">
      {/* 订单类型 */}
      <div className="flex h-[34px] shrink-0 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => form.set({ tab: tab.value })}
            className={cn(
              "flex-1 border-b-2 text-[12px] leading-[18px] transition-colors",
              tab.value === form.tab
                ? "border-brand font-semibold text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 杠杆 · 保证金模式 · 持仓模式 */}
      <div className="flex shrink-0 gap-2 pt-3.5">
        <ConfigButton active title="调整杠杆" disabled={!loggedIn} onClick={() => setDialog("leverage")}>
          {leverageNum ? `${leverageNum}x` : PLACEHOLDER}
        </ConfigButton>
        <ConfigButton title="保证金模式" disabled={!loggedIn} onClick={() => setDialog("margin")}>
          {config ? (config.marginMode === "CROSS" ? "全仓" : "逐仓") : PLACEHOLDER}
        </ConfigButton>
        <ConfigButton title="持仓模式" disabled={!loggedIn} onClick={() => setDialog("position")}>
          {positionMode === "ONE_WAY" ? "单向持仓" : "双向持仓"}
        </ConfigButton>
      </div>

      {/* 双向持仓模式才有开 / 平切换 */}
      {positionMode === "HEDGE" && (
        <div className="flex shrink-0 gap-2 pt-2.5">
          {(["OPEN", "CLOSE"] as const).map((value) => (
            <ConfigButton key={value} active={form.openClose === value} onClick={() => form.set({ openClose: value })}>
              {value === "OPEN" ? "开仓" : "平仓"}
            </ConfigButton>
          ))}
        </div>
      )}

      {/* 买 / 卖 */}
      <div className="mt-3.5 flex h-[39.5px] shrink-0 overflow-hidden rounded-[6px] border">
        <button
          type="button"
          onClick={() => form.set({ side: "BUY" })}
          className={cn(
            "flex-1 font-bold text-[13px] leading-[19.5px]",
            buy ? "bg-up text-white" : "text-muted-foreground",
          )}
        >
          买入/做多
        </button>
        <button
          type="button"
          onClick={() => form.set({ side: "SELL" })}
          className={cn(
            "flex-1 font-bold text-[13px] leading-[19.5px]",
            buy ? "text-muted-foreground" : "bg-down text-white",
          )}
        >
          卖出/做空
        </button>
      </div>

      <div className="flex flex-col gap-2.5 pt-3.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">可用</span>
          <span className="num font-mono text-foreground">
            {loggedIn ? `${formatUsdt(available)} USDT` : PLACEHOLDER}
          </span>
        </div>

        {form.tab === "CONDITIONAL" && (
          <>
            <NumberField
              label="触发价"
              unit={spec.quoteAsset}
              value={form.triggerPrice}
              error={issues.triggerPrice}
              onChange={(triggerPrice) => {
                setTouched(true);
                form.set({ triggerPrice });
              }}
              onBlur={() => form.set({ triggerPrice: snapTick(form.triggerPrice, spec) })}
            />
            <div className="flex gap-2">
              {(["CONTRACT_PRICE", "MARK_PRICE"] as const).map((value) => (
                <ConfigButton
                  key={value}
                  active={form.workingType === value}
                  onClick={() => form.set({ workingType: value })}
                >
                  {value === "CONTRACT_PRICE" ? "最新价触发" : "标记价触发"}
                </ConfigButton>
              ))}
            </div>
            <div className="flex gap-2">
              {(["LIMIT", "MARKET"] as const).map((value) => (
                <ConfigButton
                  key={value}
                  active={form.conditionalExec === value}
                  onClick={() => form.set({ conditionalExec: value })}
                >
                  {value === "LIMIT" ? "触发后限价" : "触发后市价"}
                </ConfigButton>
              ))}
            </div>
          </>
        )}

        {!isMarket && (
          <NumberField
            label={`价格 (${spec.quoteAsset})`}
            unit={spec.quoteAsset}
            value={form.price}
            error={issues.price}
            action={
              lastPrice ? <FieldAction onClick={() => form.set({ price: lastPrice })}>最新</FieldAction> : undefined
            }
            onChange={(price) => {
              setTouched(true);
              form.set({ price });
            }}
            onBlur={() => form.set({ price: snapTick(form.price, spec) })}
          />
        )}

        <NumberField
          label={`数量 (${spec.baseAsset})`}
          unit={spec.baseAsset}
          placeholder={formatPrice("0", { tickSize: spec.stepSize })}
          value={form.qty}
          error={issues.qty}
          onChange={(qty) => {
            setTouched(true);
            form.set({ qty });
          }}
        />

        <PercentSlider
          value={percentNum}
          disabled={!preview?.maxQty}
          onChange={(percent) => form.set({ qty: qtyFromPercent(preview?.maxQty ?? null, percent, lot) })}
        />

        {issues.warning && <p className="text-[10px] text-brand leading-[15px]">{issues.warning}</p>}

        {/* 选项：只减仓 + 生效时间 */}
        <div className="flex items-center justify-between">
          {positionMode === "ONE_WAY" ? (
            <label htmlFor="reduce-only" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Checkbox
                id="reduce-only"
                checked={form.reduceOnly}
                onCheckedChange={(checked: boolean) => form.set({ reduceOnly: checked })}
              />
              只减仓
            </label>
          ) : (
            <span />
          )}
          {!isMarket && (
            <select
              value={form.timeInForce}
              onChange={(e) => form.set({ timeInForce: e.target.value as TimeInForce })}
              className="rounded-[4px] border bg-background px-1.5 py-1 text-[11px] text-muted-foreground outline-none"
              aria-label="生效时间"
            >
              {TIME_IN_FORCE.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 预估区 */}
        <div className="flex flex-col gap-[3px] rounded-[5px] bg-background px-2.5 py-2 text-[11px] leading-[16.5px]">
          <EstimateRow
            label="名义价值"
            value={estimate ? `${formatUsdt(bigintToString(estimate.notional))} USDT` : `0.00 USDT`}
          />
          <EstimateRow
            label="预估保证金"
            value={estimate ? `${formatUsdt(bigintToString(estimate.margin))} USDT` : `0.00 USDT`}
          />
          <EstimateRow
            label="预估手续费"
            value={estimate ? `${formatDecimal(bigintToString(estimate.fee), 4)} USDT` : "0.0000 USDT"}
          />
          <EstimateRow label="可开最大" value={preview?.maxQty ? `${preview.maxQty} ${spec.baseAsset}` : PLACEHOLDER} />
          <EstimateRow
            label="预估强平价"
            value={preview?.liquidationPrice ? formatPrice(preview.liquidationPrice, spec) : PLACEHOLDER}
          />
        </div>

        <SubmitButton
          loggedIn={loggedIn}
          matchingEnabled={matchingEnabled}
          blocked={blocked}
          submitting={submitting}
          buy={buy}
          baseAsset={spec.baseAsset}
          onLogin={() => setLoginOpen(true)}
          onSubmit={submit}
        />
      </div>

      {config && (
        <>
          <LeverageDialog
            open={dialog === "leverage"}
            onOpenChange={(open) => setDialog(open ? "leverage" : null)}
            spec={spec}
            config={config}
          />
          <MarginModeDialog
            open={dialog === "margin"}
            onOpenChange={(open) => setDialog(open ? "margin" : null)}
            symbol={spec.symbol}
            current={config.marginMode}
          />
          <PositionModeDialog
            open={dialog === "position"}
            onOpenChange={(open) => setDialog(open ? "position" : null)}
            symbol={spec.symbol}
            current={positionMode}
          />
        </>
      )}
    </div>
  );
}

/** 还没碰过输入框时，隐藏「请输入…」这类空值提示，别一进页面就满屏红字 */
function dropEmptyFieldHints(issues: ReturnType<typeof validateOrderForm>) {
  const visible = { ...issues };
  for (const key of ["price", "triggerPrice", "qty"] as const) {
    if (visible[key]?.startsWith("请输入")) delete visible[key];
  }
  return visible;
}

function EstimateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-mono text-foreground">{value}</span>
    </div>
  );
}

function SubmitButton({
  loggedIn,
  matchingEnabled,
  blocked,
  submitting,
  buy,
  baseAsset,
  onLogin,
  onSubmit,
}: {
  loggedIn: boolean;
  matchingEnabled: boolean;
  blocked: boolean;
  submitting: boolean;
  buy: boolean;
  baseAsset: string;
  onLogin: () => void;
  onSubmit: () => void;
}) {
  if (!loggedIn) {
    return (
      <button
        type="button"
        onClick={onLogin}
        className="w-full rounded-[6px] bg-brand py-2.5 font-bold text-[14px] text-black"
      >
        登录
      </button>
    );
  }
  const disabled = !matchingEnabled || blocked || submitting;
  const text = !matchingEnabled
    ? "行情中断，暂停交易"
    : submitting
      ? "提交中…"
      : `${buy ? "买入" : "卖出"} ${baseAsset}`;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSubmit}
      className={cn(
        "w-full rounded-[6px] py-2.5 font-bold text-[14px] text-white transition-opacity",
        buy ? "bg-up" : "bg-down",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {text}
    </button>
  );
}

/** 失焦时把价格吸附到 tickSize 的整数倍（校验链第 5 步会拒非整数倍） */
function snapTick(value: string, spec: SymbolSpec): string {
  if (!value.trim()) return value;
  const snapped = floorToTick(parse(value), parse(spec.tickSize));
  return bigintToString(snapped);
}

/** bigint → 十进制字符串（展示函数都吃字符串） */
function bigintToString(value: bigint): string {
  return trimDecimal(format(value, 8));
}
