import Link from "next/link";

import { DEFAULT_SYMBOL } from "@/lib/config/constants";

/** H-01 介绍区（Figma 2:365） */
export function HeroSection() {
  return (
    <section className="mx-auto flex max-w-[900px] flex-col items-center pt-10 text-center">
      <div className="mb-6 inline-flex h-[28.5px] items-center gap-2 rounded-[20px] border border-brand/25 bg-brand/12 px-3.5 font-semibold text-[12px] text-brand leading-[18px]">
        <span className="size-1.5 rounded-full bg-brand" />
        模拟交易 · 虚拟资金 · 零风险体验
      </div>
      <h1 className="font-extrabold text-[44px] text-foreground leading-[48.4px] tracking-[-1.5px]">合约模拟盘</h1>
      <p className="w-[540px] max-w-full pt-4 text-[15px] text-muted-foreground leading-[25.5px]">
        跟随 Binance 实时合约行情的高仿真模拟交易平台。使用虚拟资金练习交易策略，掌握合约交易技巧，无需承担真实风险。
      </p>
      <div className="flex justify-center gap-3 pt-8">
        <Link
          href={`/trade/${DEFAULT_SYMBOL}`}
          className="rounded-[7px] bg-brand px-7 py-3 font-bold text-[14px] text-black leading-[21px] transition-colors hover:bg-brand/80"
        >
          开始模拟交易
        </Link>
        <Link
          href="/leaderboard"
          className="rounded-[7px] border bg-elevated px-7 py-3 font-semibold text-[14px] text-foreground leading-[21px] transition-colors hover:border-brand/40"
        >
          查看排行榜
        </Link>
      </div>
      {/* 设计稿没有这条；08 H-01 要求给出规则页入口（spec 一·6） */}
      <Link
        href="/rules"
        className="mt-4 text-[12px] text-muted-foreground leading-[18px] transition-colors hover:text-brand"
      >
        和真实交易所有哪些不同 →
      </Link>
    </section>
  );
}
