import { describe, expect, it } from "vitest";

import { nicknameIssue } from "./nickname-dialog";

describe("nicknameIssue", () => {
  it("正常昵称没有问题", () => {
    expect(nicknameIssue("小明的模拟盘")).toBeUndefined();
  });

  it("空白不行", () => {
    expect(nicknameIssue("   ")).toBe("请输入昵称");
  });

  it("超过 20 个字不行；按字符数算，中文一个算一个", () => {
    expect(nicknameIssue("一".repeat(20))).toBeUndefined();
    expect(nicknameIssue("一".repeat(21))).toContain("20");
  });

  it("表情按码点算，不会被拆成两个", () => {
    expect(nicknameIssue("🙂".repeat(20))).toBeUndefined();
    expect(nicknameIssue("🙂".repeat(21))).toContain("20");
  });

  it("控制字符不行", () => {
    expect(nicknameIssue("小明")).toContain("控制字符");
  });
});
