import { AppError } from "@binance-contract-trading-full-stack/shared";
import { sign, verify } from "hono/jwt";
import { JwtTokenExpired } from "hono/utils/jwt/types";

/**
 * 三种登录方式共用的会话 token（04-backend-design.md 第 11 节"鉴权"）。
 *
 * HS256，有效期 7 天，载荷只有 { sub: accountId, iat, exp }。
 * 设计文档原来写的是 { sub, addr, chain }——那是只有钱包登录时的形状。拆出 identities 之后账户不再有
 * "地址"，邮箱和 Google 账户也没有链，token 里只放账户 id，要身份信息就查 /auth/me（缺口 #35）。
 */

export const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

export async function signToken(accountId: string, secret: string, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return sign({ sub: accountId, iat, exp: iat + TOKEN_TTL_SECONDS }, secret, "HS256");
}

/** 校验 token，返回账户 id。过期 → TOKEN_EXPIRED；其它任何问题（格式、签名、算法）→ UNAUTHORIZED */
export async function verifyToken(token: string, secret: string): Promise<string> {
  let payload: Awaited<ReturnType<typeof verify>>;
  try {
    payload = await verify(token, secret, "HS256");
  } catch (error) {
    if (error instanceof JwtTokenExpired) throw new AppError("TOKEN_EXPIRED", "登录已过期，请重新登录");
    throw new AppError("UNAUTHORIZED", "登录状态无效，请重新登录");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new AppError("UNAUTHORIZED", "登录状态无效，请重新登录");
  }
  return payload.sub;
}
