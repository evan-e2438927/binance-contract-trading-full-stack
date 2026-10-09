import type { Chain } from "@binance-contract-trading-full-stack/shared";
import type { Provider } from "@reown/appkit-controllers";
import type { Provider as SolanaProvider } from "@reown/appkit-utils/solana";
import bs58 from "bs58";

import { requestNonce, verifySignature } from "@/server-api-module/auth/mutations";
import type { LoginResult } from "@/server-api-module/auth/types";

/**
 * 钱包登录编排：申请 nonce → 签名 → 提交验签（requirements.md AC-001/AC-002）。
 * chain 无关；EVM/Solana 的签名细节由调用方传入的 signMessage 适配好（见 evmSignMessage / solanaSignMessage）。
 * `message` 必须原样传给 signMessage，不做任何拼接/修改（AC-010，签名原文要和服务端存的一致）。
 */
export interface WalletSignInParams {
  chain: Chain;
  address: string;
  signMessage: (message: string) => Promise<string>;
  /** UI 用来切换按钮文案（AC-009），不传也能正常登录 */
  onStage?: (stage: "signing" | "verifying") => void;
}

export async function signInWithWallet(params: WalletSignInParams): Promise<LoginResult> {
  const { nonce, message } = await requestNonce({ address: params.address, chain: params.chain });
  params.onStage?.("signing");
  const signature = await params.signMessage(message);
  params.onStage?.("verifying");
  return verifySignature({ address: params.address, chain: params.chain, nonce, signature });
}

/** EVM `personal_sign`：钱包原生返回 0x 开头的十六进制签名，直接透传给后端（apps/server/src/auth/wallet.ts 按此格式校验） */
export function evmSignMessage(provider: Provider, address: string) {
  return (message: string) => provider.request<string>({ method: "personal_sign", params: [message, address] });
}

/** Solana `signMessage`：钱包返回原始签名字节，编码成 base58 字符串（后端按 bs58.decode 校验，见 apps/server/src/auth/wallet.ts） */
export function solanaSignMessage(provider: SolanaProvider) {
  return async (message: string) => bs58.encode(await provider.signMessage(new TextEncoder().encode(message)));
}

/** 判断钱包侧异常是不是"用户拒绝签名"，而不是网络错误/参数错误等其它问题（AC-003 只对拒签这一种给专门文案） */
export function isUserRejection(error: unknown): boolean {
  if (error && typeof error === "object" && (error as { code?: unknown }).code === 4001) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /reject|denied|cancel/i.test(message);
}
