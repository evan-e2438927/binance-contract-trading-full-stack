import { request } from "@/lib/axios-client/client";

import type { EmailCodeResult, LoginResult, NonceBody, NonceResult, VerifyBody } from "./types";

/** POST /auth/nonce：钱包登录第一步，申请签名原文 */
export const requestNonce = (body: NonceBody) => request.post<NonceResult>("/auth/nonce", body);

/** POST /auth/verify：钱包登录第二步，提交签名换 token */
export const verifySignature = (body: VerifyBody) => request.post<LoginResult>("/auth/verify", body);

/** POST /auth/email/code：给邮箱发验证码 */
export const sendEmailCode = (email: string) => request.post<EmailCodeResult>("/auth/email/code", { email });

/** POST /auth/email/verify：用验证码换 token */
export const verifyEmailCode = (email: string, code: string) =>
  request.post<LoginResult>("/auth/email/verify", { email, code });
