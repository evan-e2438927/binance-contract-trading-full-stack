import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { eq } from "drizzle-orm";
import { createDb } from "../index";
import { ENV } from "../env";
import { leverageBrackets } from "../schema/leverage-brackets";
import { LeverageBracketFileSchema } from "../seed/leverage-brackets.schema";
import { checkContinuity } from "./verify-brackets";

const DATA_PATH = fileURLToPath(new URL("../seed/leverage-brackets.json", import.meta.url));

async function main() {
  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const file = LeverageBracketFileSchema.parse(raw);
  const symbolNames = Object.keys(file);

  if (symbolNames.length === 0) {
    console.log("leverage-brackets.json 是空的，没有可导入的数据。先按 seed/README.md 填好。");
    return;
  }

  for (const symbol of symbolNames) {
    const brackets = file[symbol];
    if (!brackets) continue;
    const result = checkContinuity(brackets);
    if (!result.ok) {
      throw new Error(
        `${symbol} 的分层表连续性校验不通过（${JSON.stringify(result.mismatches)}），导入中止，请先修正 leverage-brackets.json`,
      );
    }
  }

  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });

  for (const symbol of symbolNames) {
    const brackets = file[symbol];
    if (!brackets) continue;
    await db.delete(leverageBrackets).where(eq(leverageBrackets.symbol, symbol));
    await db.insert(leverageBrackets).values(
      brackets.map((b) => ({
        symbol,
        bracket: b.bracket,
        notionalFloor: parse(b.notionalFloor),
        notionalCap: parse(b.notionalCap),
        maxLeverage: b.maxLeverage,
        mmr: parse(b.mmr),
        cum: parse(b.cum),
      })),
    );
  }

  console.log(`seed:brackets 完成：导入 ${symbolNames.length} 个币对的分层表。`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}