import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mul, parse } from "@binance-contract-trading-full-stack/shared";
import { LeverageBracketFileSchema, type BracketRow } from "../seed/leverage-brackets.schema";

const DATA_PATH = fileURLToPath(new URL("../seed/leverage-brackets.json", import.meta.url));

export interface ContinuityResult {
  ok: boolean;
  mismatches: { atBracket: number }[];
}

export function checkContinuity(brackets: BracketRow[]): ContinuityResult {
  const mismatches: { atBracket: number }[] = [];

  for (let i = 0; i < brackets.length - 1; i++) {
    const lower = brackets[i];
    const upper = brackets[i + 1];
    if (!lower || !upper) continue;

    const n = parse(lower.notionalCap);
    const mmLower = mul(n, parse(lower.mmr)) - parse(lower.cum);
    const mmUpper = mul(n, parse(upper.mmr)) - parse(upper.cum);

    if (mmLower !== mmUpper) {
      mismatches.push({ atBracket: lower.bracket });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

function main() {
  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const file = LeverageBracketFileSchema.parse(raw);
  const symbolNames = Object.keys(file);

  if (symbolNames.length === 0) {
    console.log("leverage-brackets.json 目前是空的——按 packages/db/src/seed/README.md 的说明人工填入后再跑这个脚本。");
    return;
  }

  let failCount = 0;
  for (const symbol of symbolNames) {
    const brackets = file[symbol];
    if (!brackets) continue;
    const result = checkContinuity(brackets);
    if (result.ok) {
      console.log(`✓ ${symbol}：${brackets.length} 层，连续性通过`);
    } else {
      failCount += 1;
      console.error(`✗ ${symbol}：边界不连续 → ${JSON.stringify(result.mismatches)}`);
    }
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}