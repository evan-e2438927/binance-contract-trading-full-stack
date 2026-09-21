import Link from "next/link";

/** B-05 榜单口径说明（缺口 #48 定的规则）。说清楚为什么有人不在榜上 */
export function RulesNote() {
  return (
    <div className="rounded-[8px] border bg-surface p-4">
      <p className="font-semibold text-[13px] text-foreground">榜单怎么算</p>
      <ul className="flex flex-col gap-1.5 pt-2.5 text-[12px] text-muted-foreground leading-[20px]">
        <li>· 收益率 = 这一期赚的 ÷ 期初权益。总榜从上次重置算起</li>
        <li>· 权益快照每天 UTC 00:00 拍一次，榜单按最近一张快照算。错过的那天不补</li>
        <li>· 这一期有成交才上榜</li>
        <li>· 这一期重置过账户的，不进日榜和周榜（否则亏完就重置，收益率可以刷）</li>
        <li>· 胜率按平仓成交算：盈利的平仓笔数 ÷ 平仓笔数。没平过仓显示 --，不是 0%</li>
      </ul>
      <Link href="/rules#reset" className="mt-3 inline-block text-[12px] text-brand hover:opacity-80">
        重置和账户规则 →
      </Link>
    </div>
  );
}
