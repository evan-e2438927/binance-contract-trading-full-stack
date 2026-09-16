import "varlock/auto-load";
import { createBracketFetcher } from "../brackets/binance-client";
import { describeBracketChange } from "../brackets/diff";
import { verifyLeverageBrackets } from "../brackets/sync";
import { ENV } from "../env";
import { createDb } from "../index";

/**
 * 对齐检查（只读）：库里每个开放币对的分层表
 *   1. 自身结构合法——层号连续、上下限衔接、杠杆不增、mmr 不减、边界维持保证金连续；
 *   2. 和官方签名接口的返回逐层逐字段一致。
 * 任何一个币对不过，退出码为 1。
 *
 * 用法：
 *   pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets
 */
async function main() {
  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  const fetchBrackets = createBracketFetcher({
    apiKey: ENV.BINANCE_API_KEY,
    secretKey: ENV.BINANCE_SECRET_KEY,
  });

  try {
    const report = await verifyLeverageBrackets({ db, fetchBrackets });
    const invalid = new Map(report.invalid.map((i) => [i.symbol, i.error]));
    const mismatched = new Map(report.mismatched.map((m) => [m.symbol, m.changes]));

    for (const symbol of report.checked) {
      const error = invalid.get(symbol);
      const changes = mismatched.get(symbol);
      if (!error && !changes) {
        console.log(`✓ ${symbol}`);
        continue;
      }
      console.error(`✗ ${symbol}`);
      if (error) console.error(`  结构不合法：${error}`);
      for (const change of changes ?? []) console.error(`  与官方不一致：${describeBracketChange(change)}`);
    }

    const failed = new Set([...invalid.keys(), ...mismatched.keys()]).size;
    console.log(`\nverify:brackets：${report.checked.length} 个开放币对，${failed} 个未通过。`);
    if (failed > 0) {
      console.log("与官方不一致时跑 sync:brackets 同步；结构不合法说明库里的数据被改坏了，同样用 sync:brackets 覆盖。");
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
