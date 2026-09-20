"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * 下单面板的输入控件（设计稿 4:5750 / 4:5761）：标签 + 输入框 + 单位后缀 + 错误红字。
 * 数值一律按字符串处理，不用 <input type="number">（它会把 "0.010" 变成 "0.01"，还会吞掉输入中的小数点）。
 */

const INPUT_CLASS =
  "h-9 w-full rounded-[5px] border bg-background px-2.5 pr-14 font-mono text-[12px] text-foreground outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-50";

export function NumberField({
  label,
  value,
  unit,
  placeholder,
  error,
  disabled,
  action,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  unit: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  /** 右侧快捷按钮（「最新」之类），放在单位左边 */
  action?: ReactNode;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <div className="w-full">
      <span className="text-[11px] text-muted-foreground leading-[16.5px]">{label}</span>
      <div className="relative pt-1">
        <input
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={onBlur}
          className={cn(INPUT_CLASS, error && "border-down focus:border-down")}
        />
        <div className="-translate-y-1/2 absolute top-[calc(50%+2px)] right-2.5 flex items-center gap-2">
          {action}
          <span className="text-[10px] text-muted-foreground leading-[15px]">{unit}</span>
        </div>
      </div>
      {error && <p className="pt-1 text-[10px] text-down leading-[15px]">{error}</p>}
    </div>
  );
}

/** 输入框右侧的小按钮（「最新」） */
export function FieldAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[10px] text-brand leading-[15px] hover:opacity-80">
      {children}
    </button>
  );
}

/** 一排分段按钮：订单类型 tab 下面的杠杆 / 保证金模式 / 持仓模式（设计稿 4:5732） */
export function ConfigButton({
  children,
  active,
  disabled,
  title,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 flex-1 rounded-[5px] border bg-elevated text-[12px] leading-[18px] transition-colors",
        active ? "font-semibold text-foreground" : "text-muted-foreground",
        disabled ? "cursor-not-allowed opacity-50" : "hover:border-brand/60",
      )}
    >
      {children}
    </button>
  );
}

/** 百分比滑块（设计稿 4:5773）：0 / 25 / 50 / 75 / 100 */
export function PercentSlider({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (percentNum: number) => void;
}) {
  return (
    <div className="w-full">
      <input
        type="range"
        min={0}
        max={100}
        step={25}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-4 w-full accent-brand disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="按可开最大数量的百分比填入"
      />
      <div className="flex justify-between pt-0.5">
        {[0, 25, 50, 75, 100].map((percent) => (
          <button
            key={percent}
            type="button"
            disabled={disabled}
            onClick={() => onChange(percent)}
            className={cn(
              "text-[10px] leading-[15px] transition-colors",
              percent === value ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {percent}%
          </button>
        ))}
      </div>
    </div>
  );
}
