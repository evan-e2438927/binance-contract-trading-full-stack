import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  // packages/shared 直接导出 .ts 源码（定点数工具、枚举、错误码），交给 Next 编译
  transpilePackages: ["@binance-contract-trading-full-stack/shared"],
};

export default nextConfig;

initOpenNextCloudflareForDev();
