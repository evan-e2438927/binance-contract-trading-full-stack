import { describe, expect, it, vi } from "vitest";
import { createResendSender, emailCodeMatches, generateEmailCode, hashEmailCode, normalizeEmail } from "../../../../apps/server/src/auth/email";

describe("邮箱验证码纯函数", () => {
  it("邮箱归一化：去空格、转小写", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("验证码永远是 6 位数字（前导 0 保留）", () => {
    for (let i = 0; i < 2000; i++) expect(generateEmailCode()).toMatch(/^\d{6}$/);
  });

  it("库里只存 sha256；比对只认原码", () => {
    const hash = hashEmailCode("012345");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("012345");
    expect(emailCodeMatches("012345", hash)).toBe(true);
    expect(emailCodeMatches("12345", hash)).toBe(false);
    expect(emailCodeMatches("012346", hash)).toBe(false);
    expect(emailCodeMatches("012345", "not-a-hash")).toBe(false);
  });
});

describe("Resend 发信", () => {
  it("按 Resend 文档发 POST /emails：Bearer 鉴权、from / to / subject / text", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    await createResendSender({ apiKey: "re_test", from: "Sim <login@example.com>", fetch: fetchMock as typeof fetch }).sendLoginCode("a@b.com", "123456");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: "Sim <login@example.com>", to: ["a@b.com"] });
    expect(body.text).toContain("123456");
  });

  it("非 2xx 抛错（路由层会回滚这条验证码并返回 SERVICE_UNAVAILABLE）", async () => {
    const fetchMock = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    await expect(
      createResendSender({ apiKey: "re_test", from: "x@example.com", fetch: fetchMock as typeof fetch }).sendLoginCode("a@b.com", "123456"),
    ).rejects.toThrow("HTTP 403");
  });
});
