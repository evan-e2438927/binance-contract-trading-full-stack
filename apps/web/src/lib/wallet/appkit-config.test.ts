import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 只验证「配置装配」这层编排逻辑，不真的去构造 WagmiAdapter/SolanaAdapter
 * （那两个构造函数会做钱包发现/事件监听等浏览器副作用，不适合在 vitest/jsdom 里跑真的）。
 */
vi.mock("@reown/appkit-adapter-wagmi", () => ({
  WagmiAdapter: vi.fn().mockImplementation(function (this: unknown, options: unknown) {
    return { __kind: "wagmi", options };
  }),
}));
vi.mock("@reown/appkit-adapter-solana", () => ({
  SolanaAdapter: vi.fn().mockImplementation(function (this: unknown) {
    return { __kind: "solana" };
  }),
}));
vi.mock("@reown/appkit/networks", () => ({
  mainnet: { id: 1, name: "mainnet" },
  solana: { id: "solana-mainnet", name: "solana" },
}));

const { WagmiAdapter } = await import("@reown/appkit-adapter-wagmi");
const { SolanaAdapter } = await import("@reown/appkit-adapter-solana");

describe("getWalletAppKitConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("关掉 AppKit 自带的邮箱/社交登录，且不传 siwx（SIWX 保持关闭）", async () => {
    const { getWalletAppKitConfig } = await import("./appkit-config");
    const config = getWalletAppKitConfig();

    expect(config.features).toMatchObject({ email: false, socials: false });
    expect(config.siwx).toBeUndefined();
  });

  it("adapters 同时装了 EVM(wagmi) 和 Solana 两个适配器，一个弹窗两条链（05-frontend-design.md:489/491）", async () => {
    const { getWalletAppKitConfig } = await import("./appkit-config");
    const config = getWalletAppKitConfig();

    expect(config.adapters).toHaveLength(2);
    expect(config.adapters?.[0]).toMatchObject({ __kind: "wagmi" });
    expect(config.adapters?.[1]).toMatchObject({ __kind: "solana" });
  });

  it("projectId 取自 lib/config/env 的 REOWN_PROJECT_ID（process.env.NEXT_PUBLIC_* 字面量，构建时内联），EVM 适配器用同一个 projectId 构造", async () => {
    const { REOWN_PROJECT_ID } = await import("@/lib/config/env");
    const { getWalletAppKitConfig } = await import("./appkit-config");
    const config = getWalletAppKitConfig();

    expect(config.projectId).toBe(REOWN_PROJECT_ID);
    expect(WagmiAdapter).toHaveBeenCalledWith(expect.objectContaining({ projectId: REOWN_PROJECT_ID }));
  });

  it("模块级单例：重复调用不重新 new 适配器（避免反复切 tab 重复注册钱包监听）", async () => {
    const { getWalletAppKitConfig } = await import("./appkit-config");

    const first = getWalletAppKitConfig();
    const second = getWalletAppKitConfig();

    expect(second).toBe(first);
    expect(WagmiAdapter).toHaveBeenCalledTimes(1);
    expect(SolanaAdapter).toHaveBeenCalledTimes(1);
  });
});
