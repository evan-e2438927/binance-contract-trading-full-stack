import { AppError } from "@binance-contract-trading-full-stack/shared";
import { decode } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { signToken, TOKEN_TTL_SECONDS, verifyToken } from "./tokens";

const SECRET = "test-secret-test-secret-test-secret-0123";

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `not AppError: ${String(error)}`;
  }
}

describe("JWT", () => {
  it("签发后能校验回账户 id；载荷只有 sub / iat / exp，有效期 7 天", async () => {
    const token = await signToken("acc-1", SECRET, Date.now());
    expect(await verifyToken(token, SECRET)).toBe("acc-1");
    const { payload } = decode(token);
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
    expect((payload.exp as number) - (payload.iat as number)).toBe(TOKEN_TTL_SECONDS);
  });

  it("过期 → TOKEN_EXPIRED", async () => {
    const token = await signToken("acc-1", SECRET, Date.now() - (TOKEN_TTL_SECONDS + 1) * 1000);
    expect(await codeOf(verifyToken(token, SECRET))).toBe("TOKEN_EXPIRED");
  });

  it("换了密钥、被改过、根本不是 JWT → UNAUTHORIZED", async () => {
    const token = await signToken("acc-1", SECRET, Date.now());
    expect(await codeOf(verifyToken(token, `${SECRET}x`))).toBe("UNAUTHORIZED");
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), sub: "acc-2" })).toString("base64url");
    expect(await codeOf(verifyToken(`${h}.${forged}.${s}`, SECRET))).toBe("UNAUTHORIZED");
    expect(await codeOf(verifyToken("hello", SECRET))).toBe("UNAUTHORIZED");
  });
});
