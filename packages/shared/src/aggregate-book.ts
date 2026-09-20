import { type Fixed, format, parse } from "./fixed";

/**
 * 盘口聚合与累计量。原来只在前端（M04），2026-09-20 移到 shared：
 * 服务端要按客户端选的精度先聚合好再推（`depth:SYMBOL:STEP` 频道），两边必须是同一套算法，
 * 各写一份迟早对不上（起因见 `docs/tutorial/S03-orderbook-precision.md`）。
 *
 * 全程 bigint，不碰浮点。
 *
 * 聚合方向按「合并后这一档还挂得住」来定：买盘价格向下取整、卖盘向上取整。
 * 例如 tickSize 0.1、精度 1 时，买单 80,715.9 归到 80,715（往下让一点，仍然买得到），
 * 卖单 80,715.1 归到 80,716（往上让一点）。反过来会把档位挪到对手方向，看上去价差变小。
 */

/** 去掉定标的尾随零。和前端 `lib/format/number.ts` 的 trimDecimal 同义 */
function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

/** bigint → 展示用的十进制字符串 */
const fixedToString = (value: Fixed): string => trimDecimal(format(value, 8));

export type BookSide = "bid" | "ask";

/** 盘口一档：[价格, 数量]，都是十进制字符串 */
export type BookLevel = readonly [price: string, qty: string];

export interface BookRow {
  /** 这一档的价格（聚合后的档位价） */
  price: string;
  /** 这一档的数量（聚合进来的各档之和） */
  qty: string;
  /** 从最优价累计到这一档的数量 */
  cumulative: string;
  /** 累计量占本侧最大累计量的百分比，0～100 的整数，只用来画背景条 */
  percentNum: number;
}

/** 价格归到所在档位：买盘向下取整、卖盘向上取整。step 必须 > 0 */
export function bucketPrice(price: Fixed, step: Fixed, side: BookSide): Fixed {
  const remainder = price % step;
  if (remainder === 0n) return price;
  return side === "bid" ? price - remainder : price - remainder + step;
}

/**
 * 把一侧的档位按 step 合并，并算出累计量和背景条百分比。
 * levels 要按币安给的顺序传进来（买盘价格从高到低、卖盘从低到高），也就是最优价在前。
 *
 * `maxRows` 截断发生在**合并之后**：先把能拿到的档位全部归桶，再取最优的前 N 桶。
 * 顺序不能反——先截断再合并的话，精度越粗剩下的行越少，正是 2026-09-20 那个 bug。
 */
export function aggregateSide(
  levels: readonly BookLevel[],
  step: string,
  side: BookSide,
  maxRows?: number,
): BookRow[] {
  const stepFixed = parse(step);
  if (stepFixed <= 0n) throw new Error(`聚合精度必须大于 0：${step}`);

  // 保持最优价在前的顺序：Map 按插入顺序遍历
  const buckets = new Map<string, Fixed>();
  for (const [price, qty] of levels) {
    const key = fixedToString(bucketPrice(parse(price), stepFixed, side));
    buckets.set(key, (buckets.get(key) ?? 0n) + parse(qty));
  }

  let cumulative = 0n;
  const rows: { price: string; qty: Fixed; cumulative: Fixed }[] = [];
  for (const [price, qty] of buckets) {
    if (maxRows !== undefined && rows.length >= maxRows) break;
    cumulative += qty;
    rows.push({ price, qty, cumulative });
  }

  const max = cumulative; // 最后一行的累计量就是本侧最大值
  return rows.map((row) => ({
    price: row.price,
    qty: fixedToString(row.qty),
    cumulative: fixedToString(row.cumulative),
    // 百分比是画条用的长度，不是金额：先用 bigint 算成 0～100 的整数，再转 number
    percentNum: max === 0n ? 0 : Number((row.cumulative * 100n) / max),
  }));
}

/**
 * 精度选项：tickSize 的 1 / 10 / 100 倍。
 *
 * ⚠️ 原来是五档（到 10000 倍，照抄币安网页版），2026-09-20 砍掉最后两档。
 * 理由是**我们的盘口根本喂不起**：接真实行情量过 6 个币对，每一档精度能产出多少行——
 *
 * | 精度 | 行数 |
 * | --- | --- |
 * | tick × 1 | 20（满） |
 * | tick × 10 | 20（满） |
 * | tick × 100 | 11～20 |
 * | tick × 1000 | **2～3** |
 * | tick × 10000 | **1** |
 *
 * 这是算术，不是某个币对的偶然：盘口近端大约只有 1000 档的深度，
 * 要在 1000 倍精度下凑出 20 行，得有 20000 档的跨度。
 * 再往远处是稀疏的零星挂单（实测 SOLUSDT 整张表跨 98 USDT，但去掉最远的 61 档就只剩 11 USDT），
 * 把那些聚合出来只会得到「量极小、价格跳空」的假档位。
 *
 * 币安敢给五档是因为它有整本真书。**我们没有就不给**——给一个点进去只有一行的选项，
 * 比少给一个选项更糟。
 */
const STEP_MULTIPLIERS = [1n, 10n, 100n];

export function stepOptions(tickSize: string): string[] {
  const base = parse(tickSize);
  return STEP_MULTIPLIERS.map((multiplier) => fixedToString(base * multiplier));
}

/** step 是不是这个 tickSize 的合法精度选项（服务端校验频道名用） */
export function isValidStep(tickSize: string, step: string): boolean {
  return stepOptions(tickSize).includes(step);
}
