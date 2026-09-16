import { describe, expect, it } from "vitest";
import { BinanceApiError, createBracketFetcher, sign } from "./binance-client";

describe("sign", () => {
  it("和币安官方文档的 HMAC-SHA256 示例一致", () => {
    // 来源：币安 API 文档「SIGNED (TRADE and USER_DATA) Endpoint Examples」
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const query =
      "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(sign(query, secret)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });
});

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(status: number, body: unknown, captured: Captured[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(JSON.stringify(body), { status, statusText: `status ${status}` });
  }) as typeof fetch;
}

describe("createBracketFetcher", () => {
  const base = { apiKey: "test-key", secretKey: "test-secret", now: () => 1_700_000_000_000 };

  it("带上 API Key 头、时间戳、recvWindow 和签名去请求官方接口", async () => {
    const captured: Captured[] = [];
    const fetchBrackets = createBracketFetcher({ ...base, fetch: fakeFetch(200, [], captured) });

    await fetchBrackets();

    expect(captured).toHaveLength(1);
    const req = captured[0];
    if (!req) throw new Error("no request captured");
    expect(req.headers["x-mbx-apikey"]).toBe("test-key");

    const url = new URL(req.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://fapi.binance.com/fapi/v1/leverageBracket");
    expect(url.searchParams.get("timestamp")).toBe("1700000000000");
    expect(url.searchParams.get("recvWindow")).toBe("10000");
    const unsigned = `timestamp=1700000000000&recvWindow=10000`;
    expect(url.searchParams.get("signature")).toBe(sign(unsigned, "test-secret"));
  });

  it("原样返回官方数组", async () => {
    const payload = [{ symbol: "BTCUSDT", brackets: [] }];
    const fetchBrackets = createBracketFetcher({ ...base, fetch: fakeFetch(200, payload) });
    await expect(fetchBrackets()).resolves.toEqual(payload);
  });

  it("非 200 时抛 BinanceApiError，带上币安错误码和排查提示", async () => {
    const fetchBrackets = createBracketFetcher({
      ...base,
      fetch: fakeFetch(401, { code: -2015, msg: "Invalid API-key, IP, or permissions for action." }),
    });

    const err = await fetchBrackets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BinanceApiError);
    expect(err).toMatchObject({ status: 401, code: -2015 });
    expect((err as Error).message).toMatch(/IP 白名单/);
  });

  it("时间戳偏差给出对应提示", async () => {
    const fetchBrackets = createBracketFetcher({
      ...base,
      fetch: fakeFetch(400, { code: -1021, msg: "Timestamp for this request is outside of the recvWindow." }),
    });
    await expect(fetchBrackets()).rejects.toThrow(/本机时间/);
  });

  it("返回不是数组时抛错，而不是把烂数据往下传", async () => {
    const fetchBrackets = createBracketFetcher({ ...base, fetch: fakeFetch(200, { brackets: [] }) });
    await expect(fetchBrackets()).rejects.toThrow(/不是数组/);
  });

  it("Key 为空时在发请求之前就报错", () => {
    expect(() => createBracketFetcher({ ...base, apiKey: "" })).toThrow(/BINANCE_API_KEY/);
    expect(() => createBracketFetcher({ ...base, secretKey: "" })).toThrow(/BINANCE_SECRET_KEY/);
  });
});
