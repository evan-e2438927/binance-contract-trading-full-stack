const FEATURES = [
  { icon: "📊", title: "真实行情", desc: "接入 Binance 实时合约数据，价格、资金费率与真实市场完全同步" },
  // 设计稿写「无限次重置」，服务端限制 24 小时一次（RESET_COOLDOWN_MS），按实际改（spec 一·5）
  { icon: "⚡", title: "零成本练习", desc: "使用 10,000 USDT 虚拟资金，每 24 小时可重置，没有任何真实资金损失风险" },
  { icon: "🏆", title: "排行榜竞技", desc: "与其他模拟交易者同台竞技，展示您的交易技巧，赢得榜单排名" },
] as const;

/** 卖点卡（Figma 2:368） */
export function FeatureCards() {
  return (
    <section className="mx-auto grid max-w-[900px] grid-cols-3 gap-4 py-12">
      {FEATURES.map((f) => (
        <div key={f.title} className="rounded-[10px] border bg-surface p-6 transition-colors hover:border-brand/40">
          <div aria-hidden className="text-[28px] leading-[42px]">
            {f.icon}
          </div>
          <div className="pt-3.5 font-bold text-[14px] text-foreground leading-[21px]">{f.title}</div>
          <div className="pt-2 text-[12px] text-muted-foreground leading-[20.4px]">{f.desc}</div>
        </div>
      ))}
    </section>
  );
}
