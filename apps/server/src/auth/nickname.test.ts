import { describe, expect, it } from "vitest";
import { defaultNickname } from "./nickname";

describe("默认昵称脱敏", () => {
  it("四种身份都不暴露完整身份", () => {
    expect(defaultNickname("wallet_evm", "0xa0cf798816d4b9b9866b5330eea46a18382f251e")).toBe("0xa0cf…251e");
    expect(defaultNickname("wallet_solana", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe("9WzD…AWWM");
    expect(defaultNickname("email", "alice@example.com")).toBe("al***@example.com");
    expect(defaultNickname("email", "a@example.com")).toBe("a***@example.com");
    expect(defaultNickname("google", "109876543210987654321")).toBe("Google 用户 4321");
  });
});
