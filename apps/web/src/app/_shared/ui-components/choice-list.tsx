"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

/** 二选一的卡片列表：每项一个标题 + 一句说明（保证金模式、持仓模式都用它） */
export function ChoiceList<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-[6px] border p-3 text-left transition-colors",
            option.value === value ? "border-brand bg-surface" : "hover:border-brand/50",
          )}
        >
          <div className="font-semibold text-[13px] text-foreground">{option.label}</div>
          <div className="pt-1 text-[11px] text-muted-foreground leading-[16px]">{option.hint}</div>
        </button>
      ))}
    </div>
  );
}
