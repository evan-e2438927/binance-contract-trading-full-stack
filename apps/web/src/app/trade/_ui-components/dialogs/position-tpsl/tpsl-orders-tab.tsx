"use client";

import { div, parse } from "@binance-contract-trading-full-stack/shared";
import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { useState } from "react";

import { formatPrice, formatQty, formatRatioAsPercent, formatUsdt, fromFixed, PLACEHOLDER } from "@/lib/format/number";
import { notify } from "@/lib/toast/notify";
import type { WorkingType } from "@/server-api-module/common/types";
import type { SymbolSpec } from "@/server-api-module/market/types";
import { cancelOrder, placeOrder } from "@/server-api-module/order/mutations";
import type { Order } from "@/server-api-module/order/types";
import type { Position } from "@/server-api-module/position/types";
import { useAccountStore } from "@/stores/account-store";

import { floorToLot, lotOf } from "../../../_lib/order-validate";
import { type PositionBasis, pnlAtTrigger } from "../../../_lib/tpsl-math";

/**
 * 止盈/止损 tab（Figma 4:369）：给同一个仓位挂**多条带数量的**止盈 / 止损单。
 *
 * 和「仓位止盈止损」的区别：这里每条单锁定数量（0.019 = 50%），可以分批止盈；
 * 那边是 closePosition，触发时按当时的全部仓位平。
 *
 * ⚠️ 「修改」不是原地改：服务端没有改单接口，做成**先撤再下**，中间有极短时间没有保护，
 * 界面上说清楚（spec 二·12）。
 */

const TPSL_TYPES = new Set(["TAKE_PROFIT", "TAKE_PROFIT_MARKET", "STOP", "STOP_MARKET"]);

export function TpslOrdersTab({
  position,
  spec,
  basis,
}: {
  position: Position;
  spec: SymbolSpec;
  basis: PositionBasis;
}) {
  const openOrders = useAccountStore((s) => s.openOrders);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [pending, setPending] = useState(false);

  // 这个仓位上的止盈止损单：同币对、同方向、触发类、带数量（closePosition 的那条归另一个 tab）
  const orders = openOrders.filter(
    (order) =>
      order.symbol === position.symbol &&
      order.positionSide === position.positionSide &&
      TPSL_TYPES.has(order.type) &&
      !order.closePosition,
  );
  const sorted = [...orders].sort((a, b) => (parse(b.stopPrice ?? "0") > parse(a.stopPrice ?? "0") ? 1 : -1));

  const cancelAll = async () => {
    setPending(true);
    try {
      await Promise.all(sorted.map((order) => cancelOrder(order.id)));
      notify.success("已全部取消");
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  if (adding || editing) {
    return (
      <TpslOrderForm
        position={position}
        spec={spec}
        basis={basis}
        editing={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">按触发价从高到低排列</span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={pending || sorted.length === 0}
            onClick={cancelAll}
            className="h-8 text-[12px]"
          >
            全部取消
          </Button>
          <Button onClick={() => setAdding(true)} className="h-8 text-[12px]">
            添加
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-muted-foreground">
          还没有止盈止损单。「添加」可以分批设置，比如先止盈一半。
        </p>
      ) : (
        sorted.map((order) => (
          <TpslOrderCard
            key={order.id}
            order={order}
            spec={spec}
            basis={basis}
            onEdit={() => setEditing(order)}
            onCanceled={() => notify.success("已取消")}
          />
        ))
      )}
    </div>
  );
}

function TpslOrderCard({
  order,
  spec,
  basis,
  onEdit,
  onCanceled,
}: {
  order: Order;
  spec: SymbolSpec;
  basis: PositionBasis;
  onEdit: () => void;
  onCanceled: () => void;
}) {
  const [pending, setPending] = useState(false);
  const isTp = order.type.startsWith("TAKE_PROFIT");
  // 这一条按自己的数量算预估盈亏（整仓的盈亏要按整仓数量，这里只算这一条覆盖的部分）
  const pnl = order.stopPrice ? pnlAtTrigger(order.stopPrice, { ...basis, qty: order.qty }) : null;
  const share = parse(basis.qty) > 0n ? div(parse(order.qty), parse(basis.qty)) : null;

  const cancel = async () => {
    setPending(true);
    try {
      await cancelOrder(order.id);
      onCanceled();
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-[8px] border bg-background p-3">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">
          触发类型（{order.workingType === "MARK_PRICE" ? "标记" : "最新"}）
        </span>
        <span className={cn("num font-semibold font-mono", isTp ? "text-up" : "text-down")}>
          {order.stopPrice ? formatPrice(order.stopPrice, spec) : PLACEHOLDER}
        </span>
      </div>
      <div className="flex items-end justify-between pt-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">预估盈亏</div>
          <div className={cn("num font-mono", pnl !== null && pnl < 0n ? "text-down" : "text-up")}>
            {pnl === null ? PLACEHOLDER : formatUsdt(fromFixed(pnl), { signed: true })}
          </div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground">委托价格</div>
          <div className="num font-mono text-foreground">
            {order.type.endsWith("MARKET") ? "市价" : formatPrice(order.price, spec)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground">数量</div>
          <div className="num font-mono text-foreground">
            {formatQty(order.qty, spec)}
            {share !== null && ` (${formatRatioAsPercent(fromFixed(share), { signed: false })})`}
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-3">
        <Button variant="ghost" onClick={onEdit} className="h-8 flex-1 border text-[12px]">
          修改
        </Button>
        <Button variant="ghost" disabled={pending} onClick={cancel} className="h-8 flex-1 border text-[12px]">
          取消
        </Button>
      </div>
    </div>
  );
}

/** 添加 / 修改表单。修改 = 先撤原单再下新单（没有改单接口） */
function TpslOrderForm({
  position,
  spec,
  basis,
  editing,
  onClose,
}: {
  position: Position;
  spec: SymbolSpec;
  basis: PositionBasis;
  editing: Order | null;
  onClose: () => void;
}) {
  // 改的是哪一条就默认选哪一种；新增默认止盈
  const [kind, setKind] = useState<"TP" | "SL">(
    editing ? (editing.type.startsWith("TAKE_PROFIT") ? "TP" : "SL") : "TP",
  );
  const [trigger, setTrigger] = useState(editing?.stopPrice ?? "");
  const [qty, setQty] = useState(editing?.qty ?? "");
  const [workingType, setWorkingType] = useState<WorkingType>(editing?.workingType ?? "CONTRACT_PRICE");
  const [pending, setPending] = useState(false);
  const lot = lotOf(spec, true);

  const setPercent = (percentNum: number) => {
    const total = parse(basis.qty);
    setQty(fromFixed(floorToLot((total * BigInt(percentNum)) / 100n, lot)));
  };

  const submit = async () => {
    setPending(true);
    try {
      // 先撤后下：中间这一小段时间这条保护是不在的，上面的说明写了这一点
      if (editing) await cancelOrder(editing.id);
      await placeOrder({
        symbol: position.symbol,
        side: basis.isLong ? "SELL" : "BUY",
        positionSide: position.positionSide,
        type: kind === "TP" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET",
        stopPrice: trigger,
        workingType,
        qty,
        ...(position.positionSide === "BOTH" ? { reduceOnly: true } : {}),
      });
      notify.success(editing ? "已修改" : "已添加");
      onClose();
    } catch (error) {
      notify.error(error);
    } finally {
      setPending(false);
    }
  };

  const pnl = trigger && qty ? pnlAtTrigger(trigger, { ...basis, qty }) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(["TP", "SL"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={cn(
              "h-8 flex-1 rounded-[5px] border text-[12px]",
              kind === value ? "border-brand font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {value === "TP" ? "止盈" : "止损"}
          </button>
        ))}
      </div>

      <Field label={`触发价 (${spec.quoteAsset})`} value={trigger} onChange={setTrigger}>
        <select
          value={workingType}
          onChange={(e) => setWorkingType(e.target.value as WorkingType)}
          aria-label="触发依据"
          className="rounded-[4px] border bg-background px-1 py-0.5 text-[11px] text-muted-foreground outline-none"
        >
          <option value="CONTRACT_PRICE">最新</option>
          <option value="MARK_PRICE">标记</option>
        </select>
      </Field>

      <Field label={`数量 (${spec.baseAsset})`} value={qty} onChange={setQty} />
      <div className="flex gap-2">
        {[25, 50, 75, 100].map((percent) => (
          <button
            key={percent}
            type="button"
            onClick={() => setPercent(percent)}
            className="h-7 flex-1 rounded-[4px] border text-[11px] text-muted-foreground hover:border-brand/60 hover:text-foreground"
          >
            {percent}%
          </button>
        ))}
      </div>

      {pnl !== null && (
        <p className="text-[11px] text-muted-foreground">
          预估盈亏{" "}
          <span className={cn("num font-mono", pnl < 0n ? "text-down" : "text-up")}>
            {formatUsdt(fromFixed(pnl), { signed: true })} USDT
          </span>
          （按触发价算，不含手续费）
        </p>
      )}

      {editing && (
        <p className="text-[11px] text-brand leading-[16.5px]">
          修改会先撤销原来那张单再重新下一张，中间有极短时间这条保护是不生效的。
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose} className="h-9 flex-1 border text-[12px]">
          返回
        </Button>
        <Button
          disabled={pending || !trigger.trim() || !qty.trim()}
          onClick={submit}
          className="h-9 flex-1 text-[12px]"
        >
          {editing ? "确认修改" : "确认添加"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="relative pt-1">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          className="h-9 w-full rounded-[6px] border bg-background px-3 pr-16 font-mono text-[12px] text-foreground outline-none focus:border-brand"
        />
        {children && <div className="-translate-y-1/2 absolute top-[calc(50%+2px)] right-2">{children}</div>}
      </div>
    </div>
  );
}
