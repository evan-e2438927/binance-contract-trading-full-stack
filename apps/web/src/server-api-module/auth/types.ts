import type { AuthProvider, Chain } from "../common/types";

/** 鉴权模块（/auth/*）的 DTO。来源：apps/server/src/auth/routes.ts */

/** POST /auth/nonce 请求体：钱包登录第一步，申请一次性签名原文 */
export interface NonceBody {
  /** 钱包地址 */
  address: string;
  /** 哪条链的钱包 */
  chain: Chain;
}

/** POST /auth/nonce 响应 */
export interface NonceResult {
  /** 一次性随机串，验签时原样带回；只能用一次 */
  nonce: string;
  /** 要让钱包签名的完整原文，原样交给钱包，不要自己拼 */
  message: string;
  /** 过期时间，过期后要重新申请 */
  expiresAt: number;
}

/** POST /auth/verify 请求体：钱包登录第二步，提交签名 */
export interface VerifyBody {
  /** 钱包地址，和申请 nonce 时一致 */
  address: string;
  /** 哪条链的钱包 */
  chain: Chain;
  /** 第一步拿到的 nonce */
  nonce: string;
  /** 钱包对 message 的签名 */
  signature: string;
}

/** POST /auth/email/code 响应：验证码已发出 */
export interface EmailCodeResult {
  /** 验证码过期时间 */
  expiresAt: number;
}

/** 登录成功（钱包 / 邮箱；Google 走整页跳转，token 在回跳地址上） */
export interface LoginResult {
  /** JWT，交给 lib/session/token 保存 */
  token: string;
  account: {
    /** 账户 id */
    id: string;
    /** true = 第一次登录，刚创建账户并发放了初始 USDT */
    isNew: boolean;
  };
}

/** GET /auth/me：当前登录的账户 */
export interface Me {
  account: {
    /** 账户 id */
    id: string;
    /** 昵称，开户时默认是脱敏后的身份（如 0x12ab…cdef）；库里允许为 null */
    nickname: string | null;
    /** 账户创建时间 */
    createdAt: number;
  };
  /** 这次登录用的身份 */
  identity: {
    /** 登录方式 */
    provider: AuthProvider;
    /** 该方式下的唯一标识：钱包地址 / 邮箱 / Google 的 sub */
    providerId: string;
  };
}
