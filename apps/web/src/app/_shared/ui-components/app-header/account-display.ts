import type { Me } from "@/server-api-module/auth/types";

/** 登录标识的简写：钱包地址这类长串取头 6 尾 4，邮箱等短标识原样 */
export function shortId(providerId: string): string {
  return providerId.length > 16 ? `${providerId.slice(0, 6)}…${providerId.slice(-4)}` : providerId;
}

/** 顶栏显示的名字：昵称优先，没有就用登录标识简写 */
export function displayName(me: Me): string {
  return me.account.nickname?.trim() || shortId(me.identity.providerId);
}

/** 头像字母：显示名的第一个字符（按码点取，不会把 emoji 切成半个）转大写 */
export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}
