import type { AuthProvider } from "@binance-contract-trading-full-stack/shared";

/**
 * 开户时的默认昵称（accounts.nickname，排行榜显示用）：脱敏后的身份，03-database-design.md 第四节。
 * 排行榜是公开的，不能把完整地址或邮箱挂出去。
 */
export function defaultNickname(provider: AuthProvider, providerId: string): string {
  switch (provider) {
    case "wallet_evm":
      return `${providerId.slice(0, 6)}…${providerId.slice(-4)}`; // 0x12ab…cdef
    case "wallet_solana":
      return `${providerId.slice(0, 4)}…${providerId.slice(-4)}`;
    case "email": {
      const at = providerId.lastIndexOf("@");
      const local = providerId.slice(0, at);
      return `${local.slice(0, Math.min(2, local.length))}***${providerId.slice(at)}`; // ab***@gmail.com
    }
    case "google":
      return `Google 用户 ${providerId.slice(-4)}`; // sub 是一串数字，本身不含个人信息
  }
}
