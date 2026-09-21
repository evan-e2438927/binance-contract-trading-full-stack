import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import type { ReactNode } from "react";

/** 规则页的排版零件。长文页面，正文宽度和行高统一在这里定，别处不要各写各的 */

/** 一级段落标题。`scroll-mt` 是给锚点跳转留的：顶栏是固定的，不留就会被盖住 */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-6 border-b pb-2 font-semibold text-[20px] text-foreground">
      {children}
    </h2>
  );
}

/** 二级段落标题 */
export function H3({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-6 pt-2 font-semibold text-[15px] text-foreground">
      {children}
    </h3>
  );
}

/** 正文段落 */
export function P({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground leading-[22px]">{children}</p>;
}

/** 要点列表 */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, index) => (
        // 静态文案，顺序固定，用下标做 key 没有问题
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态列表，不会增删或重排
        <li key={index} className="flex gap-2 text-[13px] text-muted-foreground leading-[22px]">
          <span className="text-brand">·</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** 强调框：这一页最该记住的那几句话 */
export function Callout({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "down" }) {
  return (
    <div
      className={cn(
        "rounded-[6px] border-l-2 bg-elevated/60 px-4 py-3 text-[13px] leading-[22px]",
        tone === "down" ? "border-l-down text-foreground" : "border-l-brand text-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** 关键词：正文里需要和界面上的字眼对上的地方 */
export function Term({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}
