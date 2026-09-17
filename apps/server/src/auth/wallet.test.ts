import bs58 from "bs58";
import nacl from "tweetnacl";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import { buildSignInMessage, generateNonce, normalizeAddress, verifyWalletSignature } from "./wallet";

const T0 = Date.parse("2026-09-17T08:00:00Z");
const WEB = "http://localhost:3001";

describe("normalizeAddress", () => {
  it("EVM：校验和大小写和全小写是同一个地址，统一存小写；格式不对返回 null", () => {
    const checksummed = "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e";
    expect(normalizeAddress("evm", checksummed)).toBe(checksummed.toLowerCase());
    expect(normalizeAddress("evm", ` ${checksummed.toLowerCase()} `)).toBe(checksummed.toLowerCase());
    expect(normalizeAddress("evm", "0x1234")).toBeNull();
    expect(normalizeAddress("evm", "not-an-address")).toBeNull();
  });

  it("Solana：base58 原样保留（区分大小写）；解出来不是 32 字节返回 null", () => {
    const address = bs58.encode(nacl.sign.keyPair().publicKey);
    expect(normalizeAddress("solana", address)).toBe(address);
    expect(normalizeAddress("solana", bs58.encode(new Uint8Array(31)))).toBeNull();
    expect(normalizeAddress("solana", "0OIl")).toBeNull(); // 0 O I l 不在 base58 字母表里
  });
});

describe("EVM（SIWE）", () => {
  it("生成的文本是合法 EIP-4361，viem 能解析回同样的字段", () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();
    const message = buildSignInMessage({
      chain: "evm",
      address: account.address.toLowerCase(),
      nonce,
      webOrigin: WEB,
      issuedAtMs: T0,
      expiresAtMs: T0 + 300_000,
    });
    const parsed = parseSiweMessage(message);
    expect(parsed).toMatchObject({ address: account.address, domain: "localhost:3001", uri: WEB, nonce, chainId: 1, version: "1" });
    expect(validateSiweMessage({ message: parsed, domain: "localhost:3001", nonce, time: new Date(T0 + 1000) })).toBe(true);
    expect(validateSiweMessage({ message: parsed, time: new Date(T0 + 300_001) })).toBe(false); // 过期
  });

  it("真签名能过；换一个地址、改一个字、签名格式不对都不过", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const address = signer.address.toLowerCase();
    const message = buildSignInMessage({ chain: "evm", address, nonce: generateNonce(), webOrigin: WEB, issuedAtMs: T0, expiresAtMs: T0 + 1 });
    const signature = await signer.signMessage({ message });

    expect(await verifyWalletSignature("evm", address, message, signature)).toBe(true);
    expect(await verifyWalletSignature("evm", other.address.toLowerCase(), message, signature)).toBe(false);
    expect(await verifyWalletSignature("evm", address, `${message} `, signature)).toBe(false);
    expect(await verifyWalletSignature("evm", address, message, "0xdeadbeef")).toBe(false);
    expect(await verifyWalletSignature("evm", address, message, `0x${"00".repeat(65)}`)).toBe(false);
  });
});

describe("Solana（SIWS）", () => {
  it("文本格式和 @solana/wallet-standard-util 的 createSignInMessageText 一致", () => {
    const address = bs58.encode(nacl.sign.keyPair().publicKey);
    const message = buildSignInMessage({ chain: "solana", address, nonce: "abcdef0123456789", webOrigin: WEB, issuedAtMs: T0, expiresAtMs: T0 + 300_000 });
    expect(message).toBe(
      [
        "localhost:3001 wants you to sign in with your Solana account:",
        address,
        "",
        "Sign in to the USDT-M futures paper trading simulator. This is not a transaction and costs no gas.",
        "",
        "URI: http://localhost:3001",
        "Version: 1",
        "Chain ID: mainnet",
        "Nonce: abcdef0123456789",
        "Issued At: 2026-09-17T08:00:00.000Z",
        "Expiration Time: 2026-09-17T08:05:00.000Z",
      ].join("\n"),
    );
  });

  it("真 ed25519 签名能过；别人的签名、改过的文本、长度不对的签名都不过", async () => {
    const keys = nacl.sign.keyPair();
    const address = bs58.encode(keys.publicKey);
    const message = buildSignInMessage({ chain: "solana", address, nonce: generateNonce(), webOrigin: WEB, issuedAtMs: T0, expiresAtMs: T0 + 1 });
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keys.secretKey));
    const otherSignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), nacl.sign.keyPair().secretKey));

    expect(await verifyWalletSignature("solana", address, message, signature)).toBe(true);
    expect(await verifyWalletSignature("solana", address, message, otherSignature)).toBe(false);
    expect(await verifyWalletSignature("solana", address, message.replace("Nonce", "nonce"), signature)).toBe(false);
    expect(await verifyWalletSignature("solana", address, message, bs58.encode(new Uint8Array(63)))).toBe(false);
    expect(await verifyWalletSignature("solana", address, message, "0x00")).toBe(false);
  });
});
