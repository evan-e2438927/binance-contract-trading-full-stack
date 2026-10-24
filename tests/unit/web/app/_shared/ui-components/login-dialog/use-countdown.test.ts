import { describe, expect, it } from "vitest";

import { remainingSeconds } from "../../../../../../../apps/web/src/app/_shared/ui-components/login-dialog/use-countdown";

describe("remainingSeconds", () => {
  it("刚开始：60 秒", () => {
    expect(remainingSeconds(60_000, 0)).toBe(60);
  });
  it("不足一秒按一秒算（按钮上不会出现 0 秒）", () => {
    expect(remainingSeconds(60_000, 59_001)).toBe(1);
  });
  it("到点和过点都是 0", () => {
    expect(remainingSeconds(60_000, 60_000)).toBe(0);
    expect(remainingSeconds(60_000, 75_000)).toBe(0);
  });
  it("按整秒递减", () => {
    expect(remainingSeconds(60_000, 1_000)).toBe(59);
    expect(remainingSeconds(60_000, 1_500)).toBe(59);
  });
});
