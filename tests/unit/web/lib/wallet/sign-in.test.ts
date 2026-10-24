import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server-api-module/auth/mutations", () => ({
  requestNonce: vi.fn(),
  verifySignature: vi.fn(),
}));

const { requestNonce, verifySignature } = await import("@/server-api-module/auth/mutations");
const { evmSignMessage, isUserRejection, signInWithWallet, solanaSignMessage } = await import("../../../../../apps/web/src/lib/wallet/sign-in");

const loginResult = { token: "jwt-token", account: { id: "acc-1", isNew: false } };

describe("signInWithWallet", () => {
  it("AC-001/AC-002 (happy-path): nonce → 签名 → verify，全部按顺序传参", async () => {
    vi.mocked(requestNonce).mockResolvedValue({ nonce: "n-1", message: "sign this exact text", expiresAt: 1 });
    vi.mocked(verifySignature).mockResolvedValue(loginResult);
    const signMessage = vi.fn().mockResolvedValue("0xsignature");
    const onStage = vi.fn();

    const result = await signInWithWallet({ chain: "evm", address: "0xabc", signMessage, onStage });

    expect(requestNonce).toHaveBeenCalledWith({ address: "0xabc", chain: "evm" });
    expect(verifySignature).toHaveBeenCalledWith({
      address: "0xabc",
      chain: "evm",
      nonce: "n-1",
      signature: "0xsignature",
    });
    expect(result).toBe(loginResult);
  });

  it("AC-010 (security): 传给 signMessage 的字符串和 nonce 响应的 message 全等，不做任何拼接/修改", async () => {
    const originalMessage = "  weird whitespace \n and unicode 你好 kept as-is  ";
    vi.mocked(requestNonce).mockResolvedValue({ nonce: "n-2", message: originalMessage, expiresAt: 1 });
    vi.mocked(verifySignature).mockResolvedValue(loginResult);
    const signMessage = vi.fn().mockResolvedValue("sig");

    await signInWithWallet({ chain: "solana", address: "addr", signMessage });

    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith(originalMessage);
  });

  it("onStage 先收到 signing 再收到 verifying（驱动 UI 的连接中/签名中/登录中文案，AC-009）", async () => {
    vi.mocked(requestNonce).mockResolvedValue({ nonce: "n-3", message: "msg", expiresAt: 1 });
    vi.mocked(verifySignature).mockResolvedValue(loginResult);
    const stages: string[] = [];
    const onStage = vi.fn((stage: string) => stages.push(stage));

    await signInWithWallet({
      chain: "evm",
      address: "0xabc",
      signMessage: vi.fn().mockResolvedValue("0xsig"),
      onStage,
    });

    expect(stages).toEqual(["signing", "verifying"]);
  });

  it("AC-004/AC-005 (error): verify 失败时把错误原样抛给调用方，不吞掉", async () => {
    vi.mocked(requestNonce).mockResolvedValue({ nonce: "n-4", message: "msg", expiresAt: 1 });
    const verifyError = new Error("签名已过期，请重新连接");
    vi.mocked(verifySignature).mockRejectedValue(verifyError);

    await expect(
      signInWithWallet({ chain: "evm", address: "0xabc", signMessage: vi.fn().mockResolvedValue("0xsig") }),
    ).rejects.toBe(verifyError);
  });

  it("AC-003 (error): 钱包拒绝签名时把错误原样抛给调用方，不发起 verify", async () => {
    vi.mocked(requestNonce).mockResolvedValue({ nonce: "n-5", message: "msg", expiresAt: 1 });
    const rejection = Object.assign(new Error("User rejected the request"), { code: 4001 });
    const signMessage = vi.fn().mockRejectedValue(rejection);

    await expect(signInWithWallet({ chain: "evm", address: "0xabc", signMessage })).rejects.toBe(rejection);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("AC-011 (security): 先后用 EVM 地址和 Solana 地址各登录一次，两次调用互不干扰、不产生身份合并", async () => {
    vi.mocked(requestNonce)
      .mockResolvedValueOnce({ nonce: "evm-nonce", message: "evm msg", expiresAt: 1 })
      .mockResolvedValueOnce({ nonce: "sol-nonce", message: "sol msg", expiresAt: 1 });
    const evmResult = { token: "evm-jwt", account: { id: "acc-evm", isNew: false } };
    const solResult = { token: "sol-jwt", account: { id: "acc-sol", isNew: true } };
    vi.mocked(verifySignature).mockResolvedValueOnce(evmResult).mockResolvedValueOnce(solResult);

    const first = await signInWithWallet({
      chain: "evm",
      address: "0xabc",
      signMessage: vi.fn().mockResolvedValue("0xsig"),
    });
    const second = await signInWithWallet({
      chain: "solana",
      address: "SolAddr111",
      signMessage: vi.fn().mockResolvedValue("solsig"),
    });

    // 各自独立拿到自己那次的 nonce/token，没有互相覆盖或拼在一起
    expect(requestNonce).toHaveBeenNthCalledWith(1, { address: "0xabc", chain: "evm" });
    expect(requestNonce).toHaveBeenNthCalledWith(2, { address: "SolAddr111", chain: "solana" });
    expect(verifySignature).toHaveBeenNthCalledWith(1, {
      address: "0xabc",
      chain: "evm",
      nonce: "evm-nonce",
      signature: "0xsig",
    });
    expect(verifySignature).toHaveBeenNthCalledWith(2, {
      address: "SolAddr111",
      chain: "solana",
      nonce: "sol-nonce",
      signature: "solsig",
    });
    expect(first).toBe(evmResult);
    expect(second).toBe(solResult);
    expect(first.account.id).not.toBe(second.account.id);
  });
});

describe("evmSignMessage", () => {
  it("走 personal_sign，参数顺序是 [message, address]，返回值原样透传（0x 十六进制不加工）", async () => {
    const provider = { request: vi.fn().mockResolvedValue(`0x${"ab".repeat(65)}`) };

    const signature = await evmSignMessage(provider as never, "0xabc")("sign this message");

    expect(provider.request).toHaveBeenCalledWith({ method: "personal_sign", params: ["sign this message", "0xabc"] });
    expect(signature).toBe(`0x${"ab".repeat(65)}`);
  });
});

describe("solanaSignMessage", () => {
  it("把 message 编码成 utf-8 字节传给钱包，签名字节再编码成 base58 字符串（匹配后端 bs58.decode 校验）", async () => {
    const signatureBytes = new Uint8Array([1, 2, 3, 4]);
    const provider = { signMessage: vi.fn().mockResolvedValue(signatureBytes) };

    const signature = await solanaSignMessage(provider as never)("sign this message");

    const [passedBytes] = provider.signMessage.mock.calls[0] as [Uint8Array];
    expect(new TextDecoder().decode(passedBytes)).toBe("sign this message");
    expect(signature).toBe(bs58.encode(signatureBytes));
  });
});

describe("isUserRejection", () => {
  it("EIP-1193 标准拒绝码 4001 → true", () => {
    expect(isUserRejection({ code: 4001, message: "User rejected the request" })).toBe(true);
  });

  it("错误信息含 reject/denied/cancel（不分大小写）→ true", () => {
    expect(isUserRejection(new Error("User rejected the request"))).toBe(true);
    expect(isUserRejection(new Error("Request denied by user"))).toBe(true);
    expect(isUserRejection(new Error("User cancelled"))).toBe(true);
  });

  it("其它错误（网络、格式等）→ false", () => {
    expect(isUserRejection(new Error("network timeout"))).toBe(false);
    expect(isUserRejection(new Error("invalid signature format"))).toBe(false);
  });
});
