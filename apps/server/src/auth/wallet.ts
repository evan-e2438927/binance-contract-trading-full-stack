import type { AuthProvider, Chain } from "@binance-contract-trading-full-stack/shared";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { getAddress, isAddress, verifyMessage } from "viem";
import { createSiweMessage } from "viem/siwe";

/**
 * 钱包登录的三个纯函数：地址归一化、拼待签名文本、验签（04-backend-design.md 第 11 节"钱包"）。
 * 数据库读写（auth_nonces）在 routes.ts，这里不碰。
 */

export const NONCE_TTL_MS = 5 * 60_000;

/**
 * 待签名文本里的声明句。EIP-4361 规定 statement 是 ASCII（设计文档示例写的是中文，缺口 #36），
 * 钱包弹窗里显示的就是这句——明确告诉用户"这不是交易、不花 gas"，防止被当成授权转账。
 */
export const SIGN_IN_STATEMENT =
  "Sign in to the USDT-M futures paper trading simulator. This is not a transaction and costs no gas.";

export function providerOfChain(chain: Chain): AuthProvider {
  return chain === "evm" ? "wallet_evm" : "wallet_solana";
}

/**
 * 地址归一化，同时是格式校验：不合法返回 null。
 * - EVM：十六进制不区分大小写，EIP-55 校验和只是大小写，统一存小写（identities.provider_id）
 * - Solana：base58 区分大小写，原样保留；解出来必须正好 32 字节（ed25519 公钥）
 */
export function normalizeAddress(chain: Chain, address: string): string | null {
  const trimmed = address.trim();
  if (chain === "evm") {
    // strict: false —— 全小写的地址没有校验和信息，也是合法地址
    return isAddress(trimmed, { strict: false }) ? trimmed.toLowerCase() : null;
  }
  try {
    return bs58.decode(trimmed).length === 32 ? trimmed : null;
  } catch {
    return null;
  }
}

/** 32 位十六进制：满足 EIP-4361 "至少 8 位字母数字"，128 位随机 */
export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

export interface SignInMessageParams {
  chain: Chain;
  /** normalizeAddress 之后的地址 */
  address: string;
  nonce: string;
  /** 前端页面的来源，比如 http://localhost:3001。钱包会拿它和发起签名的页面比对，对不上会警告用户 */
  webOrigin: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

/**
 * 拼完整的待签名文本。这份文本存进 auth_nonces.message，验签时只用库里这份。
 * - EVM：EIP-4361（SIWE），用 viem 的 createSiweMessage，地址要写成 EIP-55 校验和格式
 * - Solana：SIWS，格式和 @solana/wallet-standard-util 的 createSignInMessageText 一致（2026-09-17 对照源码）
 */
export function buildSignInMessage(params: SignInMessageParams): string {
  const origin = new URL(params.webOrigin);
  const issuedAt = new Date(params.issuedAtMs);
  const expirationTime = new Date(params.expiresAtMs);

  if (params.chain === "evm") {
    return createSiweMessage({
      address: getAddress(params.address),
      chainId: 1,
      domain: origin.host,
      nonce: params.nonce,
      uri: origin.origin,
      version: "1",
      statement: SIGN_IN_STATEMENT,
      issuedAt,
      expirationTime,
    });
  }

  return [
    `${origin.host} wants you to sign in with your Solana account:`,
    params.address,
    "",
    SIGN_IN_STATEMENT,
    "",
    `URI: ${origin.origin}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${params.nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expirationTime.toISOString()}`,
  ].join("\n");
}

/**
 * 验签。任何格式问题都当"签名不对"返回 false，不抛错。
 * - EVM：signature 是 0x 开头的 65 字节十六进制（personal_sign 的输出），恢复出地址和 address 比对
 * - Solana：signature 是 base58 编码的 64 字节 ed25519 签名（钱包 signMessage 返回 Uint8Array，前端 bs58 编码）
 */
export async function verifyWalletSignature(chain: Chain, address: string, message: string, signature: string): Promise<boolean> {
  if (chain === "evm") {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
    try {
      return await verifyMessage({ address: getAddress(address), message, signature: signature as `0x${string}` });
    } catch {
      return false;
    }
  }

  try {
    const signatureBytes = bs58.decode(signature);
    const publicKey = bs58.decode(address);
    if (signatureBytes.length !== nacl.sign.signatureLength || publicKey.length !== nacl.sign.publicKeyLength) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), signatureBytes, publicKey);
  } catch {
    return false;
  }
}
