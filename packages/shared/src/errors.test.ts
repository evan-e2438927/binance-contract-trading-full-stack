import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES, ERROR_HTTP_STATUS } from "./errors";

describe("errors", () => {
  it("04-backend-design.md 第 13 节列了 27 个错误码", () => {
    expect(ERROR_CODES.length).toBe(27);
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
