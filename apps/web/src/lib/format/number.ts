import { type Fixed, format, parse } from "@binance-contract-trading-full-stack/shared";

/**
 * 数值展示格式化（05-frontend-design.md 第 7 节）。时间类在 time.ts。
 *
 * 硬约束：不许 Number / parseFloat / toFixed 碰金额。这里全程 bigint：
 * 字符串 → parse()（定标 1e8）→ 在 bigint 上做 ×100 之类的精确运算 → format()（四舍五入到指定位数）→ 加千分位。
 *
 * 服务端给 null 的数（没有标记价时的未实现盈亏、强平价……）一律显示 PLACEHOLDER，不显示 0。
 *
 * 入参是服务端给的十进制字符串（server-api-module 里的 `Decimal`）。这里是通用层，不 import 业务类型，直接写 string。
 */

export const PLACEHOLDER = "--";

type Decimal = string;

/** "0.00100000" → 3；"1" → 0。按 tickSize / stepSize 推出展示位数（币安界面也是按它们显示的，不是 pricePrecision） */
export function decimalsOf(step: Decimal): number {
  const [, frac = ""] = step.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed.length;
}

function withThousands(text: string): string {
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [int = "0", frac] = unsigned.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}

function signed(value: Fixed, text: string): string {
  return value > 0n ? `+${text}` : text;
}

/** 通用：按位数四舍五入 + 千分位。signed = true 时正数前加 "+" */
export function formatDecimal(
  value: Decimal | null | undefined,
  precision: number,
  options: { signed?: boolean; thousands?: boolean } = {},
): string {
  if (value === null || value === undefined || value === "") return PLACEHOLDER;
  const fixed = parse(value);
  const raw = format(fixed, precision);
  const text = options.thousands === false ? raw : withThousands(raw);
  return options.signed ? signed(fixed, text) : text;
}

/** 价格：按币对 tickSize 的位数 */
export function formatPrice(value: Decimal | null | undefined, spec: { tickSize: Decimal }): string {
  return formatDecimal(value, decimalsOf(spec.tickSize));
}

/** 数量：按币对 stepSize 的位数 */
export function formatQty(value: Decimal | null | undefined, spec: { stepSize: Decimal }): string {
  return formatDecimal(value, decimalsOf(spec.stepSize));
}

/** USDT 金额：千分位 + 2 位小数。盈亏类传 signed: true，显示 "+1,000.00" / "-1,000.00" */
export function formatUsdt(value: Decimal | null | undefined, options: { signed?: boolean } = {}): string {
  return formatDecimal(value, 2, options);
}

/**
 * 比例 → 百分比："0.0234" → "+2.34%"。
 * 服务端的 roe、marginRatio、roi、winRate、fundingRate 都是比例（定标后 1 = 100%）。
 * 默认带符号（涨跌、盈亏）；保证金率、胜率这种没有正负之分的传 signed: false。
 */
export function formatRatioAsPercent(
  ratio: Decimal | null | undefined,
  options: { precision?: number; signed?: boolean } = {},
): string {
  if (ratio === null || ratio === undefined || ratio === "") return PLACEHOLDER;
  const percent = parse(ratio) * 100n;
  const text = `${withThousands(format(percent, options.precision ?? 2))}%`;
  return options.signed === false ? text : signed(percent, text);
}

/** 已经是百分数的值（币安 24 小时统计的 priceChangePercent："2.34" 表示 2.34%）→ "+2.34%" */
export function formatPercentValue(percent: Decimal | null | undefined, precision = 2): string {
  if (percent === null || percent === undefined || percent === "") return PLACEHOLDER;
  const fixed = parse(percent);
  return `${signed(fixed, format(fixed, precision))}%`;
}

/** 大数缩写（24 小时成交额）："1234567890.5" → "1.23B"。只用于展示，精确值放 title */
export function formatCompact(value: Decimal | null | undefined): string {
  if (value === null || value === undefined || value === "") return PLACEHOLDER;
  const fixed = parse(value);
  const abs = fixed < 0n ? -fixed : fixed;
  const units: [bigint, string][] = [
    [1_000_000_000n, "B"],
    [1_000_000n, "M"],
    [1_000n, "K"],
  ];
  for (const [unit, suffix] of units) {
    if (abs >= unit * 100_000_000n) return `${format(fixed / unit, 2)}${suffix}`;
  }
  return format(fixed, 2);
}

/** 涨跌方向，决定用 text-up / text-down / 中性灰 */
export function direction(value: Decimal | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined || value === "") return "flat";
  const fixed = parse(value);
  return fixed > 0n ? "up" : fixed < 0n ? "down" : "flat";
}

/** bigint（定标 1e8）→ 十进制字符串，去掉尾随零。展示函数都吃字符串，算完要显示就过一道这个 */
export function fromFixed(value: Fixed): string {
  return trimDecimal(format(value, 8));
}

/** 去掉定标产生的尾随零："80715.20000000" → "80715.2"、"10.00000000" → "10"。给填进输入框、做 key 的值用 */
export function trimDecimal(value: Decimal): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}
