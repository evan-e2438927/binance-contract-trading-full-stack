import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

const TONE = {
  up: "bg-up/15 text-up",
  down: "bg-down/12 text-down",
  flat: "bg-elevated text-muted-foreground",
  brand: "border bg-elevated text-brand",
} as const;

const SIZE = { sm: "size-[26px]", md: "size-7" } as const;

export type LetterAvatarTone = keyof typeof TONE;

/** 字母圆头像：币对用基础币种前两个字母（按涨跌着色），用户用显示名首字母（brand） */
export function LetterAvatar({
  text,
  tone,
  size = "md",
  className,
}: {
  text: string;
  tone: LetterAvatarTone;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold font-sans text-[11px] leading-[16.5px]",
        SIZE[size],
        TONE[tone],
        className,
      )}
    >
      {text}
    </span>
  );
}
