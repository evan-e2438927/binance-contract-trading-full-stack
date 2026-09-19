/**
 * 登录 token 的唯一存放处（05-frontend-design.md 第 12.4 节）。
 *
 * 三种登录方式（钱包 / 邮箱 / Google）拿到的都是同一种 JWT，存法、恢复法、登出法完全一样。
 * axios-client（带 Authorization 头）、ws-client（auth 消息）、auth-store（登录态）都从这里读，
 * 所以放在一个不依赖任何人的模块里，避免循环引用。
 *
 * localStorage 在隐私模式下可能抛错，读写都包 try/catch，失败时退化成只存内存。
 */

const STORAGE_KEY = "bct.token";

type Listener = (token: string | null) => void;

let current: string | null = null;
let loaded = false;
const listeners = new Set<Listener>();

function load(): string | null {
  if (loaded) return current;
  loaded = true;
  try {
    current = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
  } catch {
    current = null;
  }
  return current;
}

export function getToken(): string | null {
  return load();
}

export function setToken(token: string | null): void {
  load();
  if (token === current) return;
  current = token;
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 存不进去就只留在内存里，刷新后需要重新登录
  }
  for (const listener of listeners) listener(token);
}

/** 订阅 token 变化（登录 / 登出 / 401 被清），返回退订函数 */
export function onTokenChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
