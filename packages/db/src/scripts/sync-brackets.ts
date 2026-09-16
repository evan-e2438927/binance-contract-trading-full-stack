import "varlock/auto-load";
import { createBracketFetcher } from "../brackets/binance-client";
import { describeBracketChange } from "../brackets/diff";
import { syncLeverageBrackets } from "../brackets/sync";
import { ENV } from "../env";
import { createDb } from "../index";

/**
 * 用官方签名接口 GET /fapi/v1/leverageBracket 同步开放币对的杠杆分层表。
 *
 * 用法：
 *   pnpm --filter @binance-contract-trading-full-stack/db run sync:brackets            # 同步并写库
 *   pnpm --filter @binance-contract-trading-full-stack/db run sync:brackets --dry-run  # 只看差异，不写库
 *
 * server 每天 UTC 00:05 会自动跑同一段逻辑，这个脚本用于手动触发和排查。
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  const fetchBrackets = createBracketFetcher({
    apiKey: ENV.BINANCE_API_KEY,
    secretKey: ENV.BINANCE_SECRET_KEY,
  });

  try {
    const report = await syncLeverageBrackets({ db, fetchBrackets, dryRun });

    for (const { symbol, changes } of report.changed) {
      console.log(`${dryRun ? "将更新" : "已更新"} ${symbol}：`);
      for (const change of changes) console.log(`  - ${describeBracketChange(change)}`);
    }
    const unchanged = report.checked.length - report.changed.length;
    console.log(
      `\nsync:brackets${dryRun ? "（dry-run，未写库）" : ""} 完成：检查 ${report.checked.length} 个开放币对，` +
        `${report.changed.length} 个有变化，${unchanged} 个与官方一致。`,
    );
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
