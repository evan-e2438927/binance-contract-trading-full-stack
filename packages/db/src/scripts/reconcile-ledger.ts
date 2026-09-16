import "varlock/auto-load";
import { sql } from "drizzle-orm";
import { createDb } from "../index";
import { ENV } from "../env";

/** 用 type 而非 interface：drizzle 的 execute<T> 要求 T extends Record<string, unknown>，
 *  只有 type 别名会拿到隐式索引签名，interface 不会。 */
type MismatchRow = {
  id: string;
  wallet_balance: string;
  ledger_sum: string;
};

async function main() {
  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });

  const result = await db.execute<MismatchRow>(sql`
    SELECT a.id, a.wallet_balance, l.s AS ledger_sum
    FROM accounts a
    JOIN (SELECT account_id, SUM(amount) s FROM ledger_entries GROUP BY account_id) l
      ON l.account_id = a.id
    WHERE a.wallet_balance <> l.s
  `);

  const mismatches = result.rows;

  if (mismatches.length > 0) {
    console.error(`发现 ${mismatches.length} 个账户余额与流水不一致：`);
    for (const row of mismatches) {
      console.error(`  account=${row.id} wallet_balance=${row.wallet_balance} ledger_sum=${row.ledger_sum}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("对账通过：所有账户 wallet_balance === SUM(ledger_entries.amount)。");
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}