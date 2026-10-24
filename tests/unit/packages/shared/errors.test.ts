import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES, ERROR_HTTP_STATUS } from "../../../../packages/shared/src/errors";

describe("errors", () => {
  it("04-backend-design.md 第 13 节列了 32 个错误码（第 12 讲补上邮箱 / Google 的 5 个），第 09 讲加了 WOULD_IMMEDIATELY_TRIGGER", () => {
    expect(ERROR_CODES.length).toBe(33);
  });

  it("每个错误码都有对应的 HTTP 状态码", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code], code).toBeTypeOf("number");
    }
  });

  it("AppError 携带 code 和 message", () => {
    const err = new AppError("INSUFFICIENT_MARGIN", "可用余额不足");
    expect(err.code).toBe("INSUFFICIENT_MARGIN");
    expect(err.message).toBe("可用余额不足");
    expect(err).toBeInstanceOf(Error);
  });
});
