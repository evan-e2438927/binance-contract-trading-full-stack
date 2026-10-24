import { describe, expect, it } from "vitest";

import type { Me } from "@/server-api-module/auth/types";

import { avatarInitial, displayName, shortId } from "../../../../../../../apps/web/src/app/_shared/ui-components/app-header/account-display";

const me = (nickname: string | null, providerId: string): Me => ({
  account: { id: "a1", nickname, createdAt: 0 },
  identity: { provider: "wallet_evm", providerId },
});

describe("shortId", () => {
  it("长标识取头 6 尾 4", () => {
    expect(shortId("0x12ab34cd56ef7890aabbccddeeff00112233")).toBe("0x12ab…2233");
  });
  it("16 个字符以内原样返回", () => {
    expect(shortId("ab@gmail.com")).toBe("ab@gmail.com");
  });
});

describe("displayName", () => {
  it("有昵称用昵称", () => {
    expect(displayName(me("Google_2761", "x"))).toBe("Google_2761");
  });
  it("昵称为空或全是空白时用标识缩写", () => {
    expect(displayName(me(null, "0x12ab34cd56ef7890aabbccddeeff00112233"))).toBe("0x12ab…2233");
    expect(displayName(me("  ", "ab@gmail.com"))).toBe("ab@gmail.com");
  });
});

describe("avatarInitial", () => {
  it("取第一个字符并大写", () => {
    expect(avatarInitial("google_2761")).toBe("G");
  });
  it("中文和 emoji 按完整字符取，不截断代理对", () => {
    expect(avatarInitial("熊猫")).toBe("熊");
    expect(avatarInitial("🐼panda")).toBe("🐼");
  });
  it("空串给问号", () => {
    expect(avatarInitial("")).toBe("?");
  });
});
