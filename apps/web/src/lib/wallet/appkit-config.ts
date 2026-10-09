import { mainnet, solana } from "@reown/appkit/networks";
import type { CreateAppKit } from "@reown/appkit/react";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

import { REOWN_PROJECT_ID } from "@/lib/config/env";

/**
 * AppKit 弹窗配置。只有 wallet-connect-panel.tsx（懒加载）会 import 这个文件，
 * 不能被 wallet-login.tsx 直接/间接静态 import，否则首屏会把 AppKit 一起打包（AC-008）。
 *
 * 关掉 AppKit 自带的邮箱 / 社交登录（features.email/socials=false）和 SIWX（不传 siwx 字段）——
 * 签名验证走我们自己的 nonce/verify（docs/design/05-frontend-design.md:489）。
 *
 * 模块级单例：和 AppKitProvider 内部 memoizeCreateAppKit 的"只建一次"语义保持一致，
 * 避免用户反复切换登录弹窗的"钱包登录" tab 时重复 new 一遍 WagmiAdapter/SolanaAdapter
 * （这两个适配器的构造函数会做钱包发现/事件监听等有副作用的初始化）。
 */
let cachedConfig: CreateAppKit | null = null;

export function getWalletAppKitConfig(): CreateAppKit {
  if (cachedConfig) return cachedConfig;

  const projectId = REOWN_PROJECT_ID;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const config: CreateAppKit = {
    adapters: [new WagmiAdapter({ networks: [mainnet], projectId }), new SolanaAdapter()],
    networks: [mainnet, solana],
    projectId,
    metadata: {
      name: "合约模拟盘",
      description: "用币安真实实时行情练习 U 本位合约交易，不产生任何真实下单",
      url: origin,
      icons: origin ? [`${origin}/favicon.ico`] : [],
    },
    features: {
      email: false,
      socials: false,
    },
  };
  cachedConfig = config;
  return config;
}
