import { describe, expect, it } from "vitest";
import { scrubSentryEvent, SENTRY_EMAIL_PLACEHOLDER, SENTRY_FILTERED_PLACEHOLDER, type SentryEventLike } from "../../../../packages/shared/src/sentry-scrub";

const EVM_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
/** 44 位 base58，形态同 Solana 地址 */
const SOLANA_ADDRESS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

describe("scrubSentryEvent", () => {
  it("AC-014 (security): 删除 Authorization / Cookie / Set-Cookie 请求头（大小写不敏感）和 request.cookies，保留其它头", () => {
    const result = scrubSentryEvent<SentryEventLike>({
      request: {
        headers: { Authorization: "Bearer abc", cookie: "sid=1", "Set-Cookie": "sid=2", "User-Agent": "vitest" },
        cookies: { sid: "1" },
      },
    });
    expect(result?.request?.headers).toEqual({ "User-Agent": "vitest" });
    expect(result?.request).not.toHaveProperty("cookies");
  });

  it("AC-015 (security): 删除请求体和 user，查询串里的敏感参数值替换为 [Filtered]，其它参数保留", () => {
    const result = scrubSentryEvent<SentryEventLike>({
      request: {
        data: { code: "123456", email: "a@b.com" },
        query_string: "token=a&code=1&signature=s&email=e&state=x&page=2",
      },
      user: { id: "1", email: "a@b.com", ip_address: "1.2.3.4" },
    });
    expect(result).not.toHaveProperty("user");
    expect(result?.request).not.toHaveProperty("data");
    const F = SENTRY_FILTERED_PLACEHOLDER;
    expect(result?.request?.query_string).toBe(`token=${F}&code=${F}&signature=${F}&email=${F}&state=${F}&page=2`);
  });

  it("AC-015 (security): 键值对象和 [键, 值] 数组形式的 query_string 同样被脱敏", () => {
    const asObject = scrubSentryEvent<SentryEventLike>({ request: { query_string: { token: "a", page: "2" } } });
    expect(asObject?.request?.query_string).toEqual({ token: SENTRY_FILTERED_PLACEHOLDER, page: "2" });
    const asPairs = scrubSentryEvent<SentryEventLike>({
      request: {
        query_string: [
          ["Code", "1"],
          ["page", "2"],
        ],
      },
    });
    expect(asPairs?.request?.query_string).toEqual([
      ["Code", SENTRY_FILTERED_PLACEHOLDER],
      ["page", "2"],
    ]);
  });

  it("AC-015 (security): request.url 里的查询串也脱敏，hash 保留", () => {
    const result = scrubSentryEvent<SentryEventLike>({
      request: { url: "https://api.example.com/auth/google/callback?code=abc&state=xyz&lang=zh#top" },
    });
    expect(result?.request?.url).toBe(
      `https://api.example.com/auth/google/callback?code=${SENTRY_FILTERED_PLACEHOLDER}&state=${SENTRY_FILTERED_PLACEHOLDER}&lang=zh#top`,
    );
  });

  it("AC-016 (security): message / exception.values[].value / breadcrumbs[].message 里的邮箱替换为 [email]", () => {
    const text = "login failed for alice@example.com";
    const expected = `login failed for ${SENTRY_EMAIL_PLACEHOLDER}`;
    const result = scrubSentryEvent<SentryEventLike>({
      message: text,
      exception: { values: [{ value: text }] },
      breadcrumbs: [{ message: text }],
    });
    expect(result?.message).toBe(expected);
    expect(result?.exception?.values?.[0]?.value).toBe(expected);
    expect(result?.breadcrumbs?.[0]?.message).toBe(expected);
  });

  it("AC-017 (security): EVM 和 Solana 地址只保留前 6 后 4", () => {
    const result = scrubSentryEvent<SentryEventLike>({ message: `evm=${EVM_ADDRESS} sol=${SOLANA_ADDRESS}` });
    expect(SOLANA_ADDRESS).toHaveLength(44);
    expect(result?.message).toBe(`evm=0x1234…5678 sol=${SOLANA_ADDRESS.slice(0, 6)}…${SOLANA_ADDRESS.slice(-4)}`);
  });

  it("AC-017 (security): 普通短单词和 40 位以内的内容不被当成地址", () => {
    const result = scrubSentryEvent<SentryEventLike>({ message: "Cannot read properties of undefined (reading 'symbol')" });
    expect(result?.message).toBe("Cannot read properties of undefined (reading 'symbol')");
  });

  it("AC-018 (error): 事件结构异常（exception.values 不是数组）时返回 null 且不抛出", () => {
    const malformed = { exception: { values: { value: "x" } } } as unknown as SentryEventLike;
    expect(() => scrubSentryEvent(malformed)).not.toThrow();
    expect(scrubSentryEvent(malformed)).toBeNull();
  });

  it("AC-018 (error): request.headers / query_string 类型不对同样返回 null", () => {
    expect(scrubSentryEvent({ request: { headers: "x" } } as unknown as SentryEventLike)).toBeNull();
    expect(scrubSentryEvent({ request: { query_string: 42 } } as unknown as SentryEventLike)).toBeNull();
  });

  it("AC-019 (boundary): 空事件原样返回，不凭空增加字段", () => {
    expect(scrubSentryEvent<SentryEventLike>({})).toEqual({});
    expect(scrubSentryEvent<SentryEventLike>({ message: "plain" })).toEqual({ message: "plain" });
  });

  it("AC-019 (boundary): 只有 request 没有 headers 时不抛异常，不增加 headers 字段", () => {
    const result = scrubSentryEvent<SentryEventLike>({ request: { url: "https://x.test/a" } });
    expect(result).toEqual({ request: { url: "https://x.test/a" } });
  });

  it("不修改传入的事件对象", () => {
    const input: SentryEventLike = { message: "a@b.com", request: { headers: { Cookie: "x" } }, user: { id: "1" } };
    const snapshot = JSON.parse(JSON.stringify(input));
    scrubSentryEvent(input);
    expect(input).toEqual(snapshot);
  });

  it("透传未知字段（如 tags、extra）", () => {
    const result = scrubSentryEvent({ message: "x", tags: { method: "GET" } } as SentryEventLike & { tags: Record<string, string> });
    expect(result?.tags).toEqual({ method: "GET" });
  });
});
