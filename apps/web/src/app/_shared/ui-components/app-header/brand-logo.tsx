import Link from "next/link";

/** G-01 左侧 Logo（Figma 2:7）：黄色 M 方块 + 产品名 + 「模拟交易·虚拟资金」标签 */
export function BrandLogo() {
  return (
    <Link href="/" className="mr-4 flex shrink-0 items-center gap-2">
      <span className="flex size-[26px] items-center justify-center rounded-[5px] bg-brand font-bold text-[12px] text-black leading-[18px]">
        M
      </span>
      <span className="font-bold text-[14px] text-foreground leading-[21px] tracking-[-0.3px]">合约模拟盘</span>
      <span className="rounded-[3px] bg-brand/14 px-1.5 py-0.5 font-semibold text-[10px] text-brand leading-[15px]">
        模拟交易·虚拟资金
      </span>
    </Link>
  );
}
