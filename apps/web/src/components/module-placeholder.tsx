import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";

/**
 * 页面骨架阶段的占位块。编号和 docs/design/08-frontend-pages.md 的模块清单一一对应，
 * Figma 设计稿里的 frame 用同样的编号命名，实现时按编号替换成真组件。
 */
export function ModulePlaceholder({
  id,
  name,
  note,
  className,
}: {
  id: string;
  name: string;
  note?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-24 flex-col items-center justify-center gap-1 border border-dashed bg-card/60 p-3 text-center",
        className,
      )}
    >
      <span className="font-mono text-brand text-xs">{id}</span>
      <span className="text-sm">{name}</span>
      {note && <span className="max-w-72 text-muted-foreground text-xs">{note}</span>}
    </section>
  );
}
