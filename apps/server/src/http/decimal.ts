import { format, parse, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { z } from "zod";

/**
 * 金额 / 价格 / 数量过 JSON 边界（CLAUDE.md 硬约束 4：bigint 不许直接进 JSON）。
 *
 * 进：只收**字符串**形式的非负十进制数，最多 8 位小数。
 * - 不收 JSON 数字：`0.1` 进 JSON.parse 就已经是二进制浮点数了，精度在我们看到之前就丢了
 * - 超过 8 位小数**拒绝**，不截断：shared 的 parse() 会静默截掉第 9 位，用户以为下了 0.123456789，实际是 0.12345678——
 *   宁可说做不到，不悄悄改用户的数
 * - 不收科学计数法、正负号、前后空格
 *
 * 出：format() 按 8 位小数精确输出，再去掉末尾多余的 0（"50000.25"、"0"、"-12.5"），不丢任何精度。
 */

const DECIMAL = /^(0|[1-9]\d*)(\.\d{1,8})?$/;

export function decimalInput(label: string) {
  return z
    .string({ error: `${label}要用字符串传，例如 "0.01"` })
    .regex(DECIMAL, `${label}格式不对：要求非负十进制数、最多 8 位小数，例如 "50000.5"`)
    .transform((value): Fixed => parse(value));
}

export function toDecimal(value: Fixed): string {
  const text = format(value);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function toDecimalOrNull(value: Fixed | null): string | null {
  return value === null ? null : toDecimal(value);
}
