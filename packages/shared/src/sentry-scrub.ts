/**
 * Sentry 事件脱敏（server 与 web 共用，`beforeSend` 里调用）。
 *
 * 取舍：脱敏过程中任何一步出错就整条丢弃（返回 null）。宁可少报一条错误，也不把没脱干净的内容发出去。
 * 这里不 import `@sentry/*`：shared 要保持零依赖，所以只声明脱敏用得到的最小结构。
 */

/** 查询参数被抹掉值之后的占位符 */
export const SENTRY_FILTERED_PLACEHOLDER = "[Filtered]";

/** 邮箱被抹掉之后的占位符 */
export const SENTRY_EMAIL_PLACEHOLDER = "[email]";

/** 钱包地址缩写时保留的前缀长度（EVM 的 `0x` + 4 位） */
const ADDRESS_KEEP_HEAD = 6;

/** 钱包地址缩写时保留的后缀长度 */
const ADDRESS_KEEP_TAIL = 4;

/** 地址缩写的省略号 */
const ADDRESS_ELLIPSIS = "…";

/** 必须整条删除的请求头（小写比较） */
const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set(["authorization", "cookie", "set-cookie"]);

/** 值必须被抹掉的查询参数名（小写比较）：登录凭据、验证码、签名、邮箱、OAuth state */
const SENSITIVE_QUERY_KEYS: ReadonlySet<string> = new Set(["token", "code", "signature", "email", "state"]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EVM_ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/g;
/** Solana 地址：32～44 位 base58。会误伤同形态的长标识符，后果只是日志里多打了码（requirements ASM-006） */
const SOLANA_ADDRESS_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** 脱敏需要读写的最小事件结构，字段含义同 Sentry 的 ErrorEvent；多余字段原样透传 */
export interface SentryEventLike {
  message?: string;
  user?: unknown;
  request?: {
    url?: string;
    headers?: Record<string, string>;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string }[];
}

/** 把地址缩成「前 6 + … + 后 4」，例如 `0x1234…5678` */
function abbreviateAddress(address: string): string {
  return `${address.slice(0, ADDRESS_KEEP_HEAD)}${ADDRESS_ELLIPSIS}${address.slice(-ADDRESS_KEEP_TAIL)}`;
}

/**
 * 抹掉一段文本里的邮箱和钱包地址。
 * 顺序固定：先邮箱、再 EVM 地址、最后 Solana 地址（EVM 地址缩写之后不会再被 Solana 规则命中）。
 */
function scrubText(text: string): string {
  return text
    .replace(EMAIL_PATTERN, SENTRY_EMAIL_PLACEHOLDER)
    .replace(EVM_ADDRESS_PATTERN, abbreviateAddress)
    .replace(SOLANA_ADDRESS_PATTERN, abbreviateAddress);
}

/** 查询串里敏感参数的值替换为占位符，其它参数原样保留（不重新编码，避免改动原有格式） */
function scrubQueryString(query: string): string {
  return query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      if (!SENSITIVE_QUERY_KEYS.has(decodeKey(key).toLowerCase())) return pair;
      return `${key}=${SENTRY_FILTERED_PLACEHOLDER}`;
    })
    .join("&");
}

/** 参数名可能被百分号编码，解不开就按原文比较 */
function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** `request.url` 里带的查询串同样要脱敏 */
function scrubUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const hashStart = url.indexOf("#", queryStart);
  const queryEnd = hashStart === -1 ? url.length : hashStart;
  return `${url.slice(0, queryStart + 1)}${scrubQueryString(url.slice(queryStart + 1, queryEnd))}${url.slice(queryEnd)}`;
}

/** Sentry 的 query_string 可能是字符串、键值对象或 [键, 值] 数组；其它类型视为结构异常 */
function scrubQueryValue(query: unknown): unknown {
  if (typeof query === "string") return scrubQueryString(query);
  if (Array.isArray(query)) {
    return query.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError("query_string 数组元素必须是 [键, 值]");
      return SENSITIVE_QUERY_KEYS.has(String(pair[0]).toLowerCase()) ? [pair[0], SENTRY_FILTERED_PLACEHOLDER] : pair;
    });
  }
  if (query !== null && typeof query === "object") {
    return Object.fromEntries(
      Object.entries(query).map(([key, value]) => [key, SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? SENTRY_FILTERED_PLACEHOLDER : value]),
    );
  }
  throw new TypeError("query_string 类型不合法");
}

/** 取出必须是数组的字段；缺失返回 undefined，类型不对直接抛（让外层丢弃整条事件） */
function expectArray<T>(value: unknown, field: string): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${field} 必须是数组`);
  return value as T[];
}

function scrubRequest(request: NonNullable<SentryEventLike["request"]>): NonNullable<SentryEventLike["request"]> {
  const { cookies: _cookies, data: _data, ...rest } = request;
  const next: NonNullable<SentryEventLike["request"]> = { ...rest };
  if (request.headers !== undefined) {
    if (request.headers === null || typeof request.headers !== "object") throw new TypeError("request.headers 必须是对象");
    next.headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !SENSITIVE_HEADER_NAMES.has(name.toLowerCase())));
  }
  if (request.query_string !== undefined) next.query_string = scrubQueryValue(request.query_string);
  if (typeof request.url === "string") next.url = scrubUrl(request.url);
  return next;
}

/**
 * 对一条待发送的 Sentry 事件脱敏，供 `beforeSend` 使用。
 *
 * 规则：
 * - 删除 `Authorization` / `Cookie` / `Set-Cookie` 请求头（大小写不敏感）、`request.cookies`、`request.data`、`user`
 * - 查询串（`request.query_string` 与 `request.url` 里的）中 token / code / signature / email / state 的值替换为 `[Filtered]`
 * - `message`、`exception.values[].value`、`breadcrumbs[].message` 里的邮箱替换为 `[email]`，钱包地址只留前 6 后 4
 *
 * @param event 待发送的事件，不会被修改（返回的是新对象）
 * @returns 脱敏后的事件；脱敏过程中出现任何异常（事件结构不合法等）返回 null，调用方应当丢弃该事件
 * @example
 * scrubSentryEvent({ message: "failed for a@b.com" }); // { message: "failed for [email]" }
 */
export function scrubSentryEvent<E extends SentryEventLike>(event: E): E | null {
  try {
    const { user: _user, ...rest } = event;
    const next: SentryEventLike = { ...rest };

    if (typeof event.message === "string") next.message = scrubText(event.message);
    if (event.request !== undefined) next.request = scrubRequest(event.request);

    const values = expectArray<{ value?: string }>(event.exception?.values, "exception.values");
    if (values && event.exception) {
      next.exception = {
        ...event.exception,
        values: values.map((item) => (typeof item.value === "string" ? { ...item, value: scrubText(item.value) } : item)),
      };
    }

    const breadcrumbs = expectArray<{ message?: string }>(event.breadcrumbs, "breadcrumbs");
    if (breadcrumbs) {
      next.breadcrumbs = breadcrumbs.map((item) => (typeof item.message === "string" ? { ...item, message: scrubText(item.message) } : item));
    }

    return next as E;
  } catch {
    return null;
  }
}
