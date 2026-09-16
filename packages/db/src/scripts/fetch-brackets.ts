import "varlock/auto-load";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LeverageBracketFileSchema,
  type BracketRow,
} from "../seed/leverage-brackets.schema";
import { checkContinuity } from "./verify-brackets";

/**
 * 从币安拉取杠杆分层表，生成 seed/leverage-brackets.json。
 *
 * 这是 seed/README.md 里"人工核对"那一步的替代方案：数据直接来自币安自己的返回，
 * 而不是凭记忆写出来的数字。人工抄 20 个币对 × 十几层是一件极容易抄错、而且
 * `verify:brackets` 查不出来的事（连续性校验只能发现层间不衔接，发现不了整体抄错一档）。
 *
 * ⚠️ 这个接口是币安网页端用的 bapi，**不在官方 API 文档里**，可能随时改结构或下线。
 * 脚本对返回做了严格校验：字段缺失、数值异常、连续性不过，一律抛错中止，不写文件。
 * 如果哪天它挂了，退回 README.md 描述的人工流程。
 *
 * 用法：
 *   pnpm --filter @binance-contract-trading-full-stack/db run fetch:brackets
 *   pnpm --filter @binance-contract-trading-full-stack/db run fetch:brackets BTCUSDT ETHUSDT
 *
 * 跑完务必抽查几个币对对着币安 App 的"杠杆分层标准"页面核一遍——这个脚本消除的是
 * 抄写错误，不是"数据源可能变"这个风险。
 */

const BRACKETS_URL =
  "https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets";

const OUT_PATH = fileURLToPath(
  new URL("../seed/leverage-brackets.json", import.meta.url),
);

/** 默认开放的币对。要增减直接改这里，或者在命令行里传币对名覆盖。 */
const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "TRXUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "NEARUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "SUIUSDT",
  "TONUSDT",
  "FILUSDT",
];

interface RiskBracket {
  bracketSeq: number;
  bracketNotionalFloor: number;
  bracketNotionalCap: number;
  bracketMaintenanceMarginRate: number;
  cumFastMaintenanceAmount: number;
  maxOpenPosLeverage: number;
}

interface SymbolBrackets {
  symbol: string;
  riskBrackets: RiskBracket[];
}

/**
 * JSON 数值 → 定标 1e8 能精确表示的十进制字符串。
 *
 * 币安返回的是 JSON number，经过 JS 浮点后可能带上 0.012500000000000001 这种尾巴，
 * 大数也可能被 String() 写成 1e+21。两种情况都直接抛错而不是四舍五入——
 * 一个悄悄被抹平的小数位，会变成所有强平价上一个查不出来的系统性偏差。
 */
function toDecimalString(value: number, field: string, symbol: string): string {
  if (!Number.isFinite(value)) {
    throw new Error(`${symbol} 的 ${field} 不是有限数：${value}`);
  }
  const s = String(value);
  if (s.includes("e") || s.includes("E")) {
    throw new Error(`${symbol} 的 ${field} 是科学计数法，无法安全转成定标值：${s}`);
  }
  const decimals = s.split(".")[1]?.length ?? 0;
  if (decimals > 8) {
    throw new Error(
      `${symbol} 的 ${field} 小数位超过 8（定标 1e8 存不下）：${s}。` +
        `这多半是浮点误差，需要人工确认币安页面上的真实值。`,
    );
  }
  return s;
}

function toBracketRows(entry: SymbolBrackets): BracketRow[] {
  const sorted = [...entry.riskBrackets].sort(
    (a, b) => a.bracketSeq - b.bracketSeq,
  );

  return sorted.map((r, i) => {
    if (r.bracketSeq !== i + 1) {
      throw new Error(
        `${entry.symbol} 的层号不连续：第 ${i + 1} 层的 bracketSeq 是 ${r.bracketSeq}`,
      );
    }
    if (!Number.isInteger(r.maxOpenPosLeverage) || r.maxOpenPosLeverage < 1) {
      throw new Error(
        `${entry.symbol} 第 ${r.bracketSeq} 层的最大杠杆异常：${r.maxOpenPosLeverage}`,
      );
    }
    return {
      bracket: r.bracketSeq,
      notionalFloor: toDecimalString(
        r.bracketNotionalFloor,
        "notionalFloor",
        entry.symbol,
      ),
      notionalCap: toDecimalString(
        r.bracketNotionalCap,
        "notionalCap",
        entry.symbol,
      ),
      maxLeverage: r.maxOpenPosLeverage,
      mmr: toDecimalString(
        r.bracketMaintenanceMarginRate,
        "mmr",
        entry.symbol,
      ),
      cum: toDecimalString(
        r.cumFastMaintenanceAmount,
        "cum",
        entry.symbol,
      ),
    };
  });
}

async function main() {
  const wanted = process.argv.slice(2);
  const targets = wanted.length > 0 ? wanted : DEFAULT_SYMBOLS;

  const res = await fetch(BRACKETS_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) {
    throw new Error(`拉取分层表失败：${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    success?: boolean;
    data?: { brackets?: SymbolBrackets[] };
  };
  const brackets = body.data?.brackets;
  if (!brackets || brackets.length === 0) {
    throw new Error("返回里没有 data.brackets，接口结构可能已经变了");
  }

  const bySymbol = new Map(brackets.map((b) => [b.symbol, b]));
  const missing = targets.filter((s) => !bySymbol.has(s));
  if (missing.length > 0) {
    throw new Error(`币安没有返回这些币对的分层表：${missing.join(", ")}`);
  }

  const file: Record<string, BracketRow[]> = {};
  for (const symbol of targets) {
    const entry = bySymbol.get(symbol);
    if (!entry) continue;
    const rows = toBracketRows(entry);

    const result = checkContinuity(rows);
    if (!result.ok) {
      throw new Error(
        `${symbol} 的分层表连续性校验不通过：${JSON.stringify(result.mismatches)}，不写文件`,
      );
    }
    file[symbol] = rows;
  }

  // 用同一份 schema 再过一遍，保证写出去的文件 verify/seed 一定读得进来
  LeverageBracketFileSchema.parse(file);

  writeFileSync(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf-8");

  for (const symbol of targets) {
    console.log(`  ✓ ${symbol}：${file[symbol]?.length} 层`);
  }
  console.log(
    `\nfetch:brackets 完成：${targets.length} 个币对已写入 seed/leverage-brackets.json。`,
  );
  console.log(
    "请抽查几个币对对照币安 App 的「杠杆分层标准」页面核对后再跑 seed:brackets。",
  );
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
