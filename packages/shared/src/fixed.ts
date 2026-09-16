export const SCALE = 100_000_000n;

/** 定标后的整数：1 单位 = 1e-8。全系统金额/价格/数量的唯一表示形式。 */
export type Fixed = bigint;

/** 十进制字符串 → 定标整数。超过 8 位小数直接截断，不四舍五入。 */
export function parse(input: string): Fixed {
  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [intPart = "0", fracPartRaw = ""] = unsigned.split(".");
  const fracPart = fracPartRaw.slice(0, 8).padEnd(8, "0");
  const value = BigInt(`${intPart}${fracPart}`);
  return negative ? -value : value;
}

/**
 * 定标整数 → 十进制字符串，precision 控制小数位数（默认 8，即不损失精度）。
 * precision < 8 时对被截掉的部分四舍五入，不是简单截断——强平价这类内部按 8 位算出来的数值，
 * 展示时截到 2 位必须是四舍五入后的数字，否则会和按四舍五入手算出来的验证值对不上
 * （比如 55000 ÷ 1.004 = 54780.876494…，四舍五入到 2 位是 54780.88，截断成 54780.87 就错了）。
 */
export function format(value: Fixed, precision = 8): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(8 - precision);
  const rounded = ((abs + divisor / 2n) / divisor) * divisor;
  const intPart = rounded / SCALE;
  const fracPart = (rounded % SCALE).toString().padStart(8, "0").slice(0, precision);
  const sign = negative && rounded !== 0n ? "-" : "";
  return precision > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/** 乘法，截断。 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return (a * b) / SCALE;
}

/** 除法，截断。除数为零抛错。 */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error("division by zero");
  return (a * SCALE) / b;
}


/** 乘法，向上取整（远离零），用于手续费——摩擦成本不被低估。假设操作数均非负。 */
export function mulCeil(a: Fixed, b: Fixed): Fixed {
  const product = a * b;
  const q = product / SCALE;
  const r = product % SCALE;
  return r === 0n ? q : q + 1n;
}

/** 除法，四舍五入（round half up），用于保证金率/强平价/未实现盈亏等展示类数值。 */
export function divRound(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error("division by zero");
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const numerator = absA * SCALE * 2n + absB;
  const rounded = numerator / (absB * 2n);
  return negative ? -rounded : rounded;
}

/** 乘法，四舍五入（round half up），用于未实现盈亏/保证金等展示类数值。 */
export function mulRound(a: Fixed, b: Fixed): Fixed {
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const rounded = (absA * absB * 2n + SCALE) / (SCALE * 2n);
  return negative ? -rounded : rounded;
}

/** 价格对齐 tickSize：买单向下，卖单向上。保守，不凭空给用户更好的价。 */
export function alignPrice(price: Fixed, tickSize: Fixed, side: "BUY" | "SELL"): Fixed {
  if (tickSize <= 0n) throw new Error("tickSize must be positive");
  const remainder = price % tickSize;
  if (remainder === 0n) return price;
  const floor = price - remainder;
  return side === "BUY" ? floor : floor + tickSize;
}

/** 数量对齐 stepSize：一律向下。不能超出用户想下的量。 */
export function alignQty(qty: Fixed, stepSize: Fixed): Fixed {
  if (stepSize <= 0n) throw new Error("stepSize must be positive");
  return qty - (qty % stepSize);
}