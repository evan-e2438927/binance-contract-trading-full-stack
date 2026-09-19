"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import Image from "next/image";
import { useState } from "react";

import { LetterAvatar } from "./letter-avatar";

/**
 * 本地有图标的币种（public/icons/coins/，来源和加新币种的步骤见同目录 README.md）。
 * 不在清单里的直接显示字母头像，不去请求一个注定 404 的文件。
 */
const COIN_ICONS = new Set([
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "DOT",
  "TRX",
  "LTC",
  "BCH",
  "NEAR",
  "APT",
  "ARB",
  "OP",
  "SUI",
  "FIL",
]);

/** 币种图标（圆形）。没有图标或加载失败时回退到币种前两个字母的头像 */
export function CoinIcon({
  asset,
  className,
}: {
  /** 基础币种，如 "BTC" */
  asset: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!COIN_ICONS.has(asset) || failed) {
    return <LetterAvatar text={asset.slice(0, 2)} tone="flat" className={className} />;
  }
  return (
    <Image
      src={`/icons/coins/${asset}.svg`}
      alt={asset}
      width={28}
      height={28}
      unoptimized
      onError={() => setFailed(true)}
      className={cn("size-7 shrink-0 rounded-full", className)}
    />
  );
}
