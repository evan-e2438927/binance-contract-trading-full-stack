import { OPEN_SYMBOLS } from "@binance-contract-trading-full-stack/db/brackets/open-symbols";
import { format, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { fetchSymbolStatuses } from "./exchange-info";
import { startMarketFeed } from "./market-feed";

/**
 * 第 10 讲验收用：`pnpm --filter server market:watch`，终端每秒刷新一次开放币对的行情。
 * 不连数据库、不需要环境变量。拔掉网线（或关掉代理）等 10 秒，状态会变成 degraded，插回去自动恢复。
 * 启动时先查 exchangeInfo，只订阅 status = TRADING 的币对（下架结算中的币对盘口为空，订阅了永远 ready 不了）。
 */

const statuses = await fetchSymbolStatuses(OPEN_SYMBOLS);
const skipped = statuses.filter((s) => s.status !== "TRADING");
if (skipped.length > 0) {
  console.log(`跳过不在交易状态的币对：${skipped.map((s) => `${s.symbol}(${s.status})`).join("、")}`);
}
const symbols = statuses.filter((s) => s.status === "TRADING").map((s) => s.symbol);

interface Row {
  last?: Fixed;
  mark?: Fixed;
  bid?: Fixed;
  ask?: Fixed;
  rate?: Fixed;
}

const rows = new Map<string, Row>(symbols.map((s) => [s, {}]));
const show = (value: Fixed | undefined, precision = 4) => (value === undefined ? "—" : format(value, precision));

const feed = startMarketFeed({
  symbols,
  logger: { log: () => {}, error: (...args: unknown[]) => console.error(...args) },
  onEvent(event) {
    const row = rows.get(event.symbol);
    if (!row) return;
    if (event.t === "trade") row.last = event.price;
    if (event.t === "markPrice") {
      row.mark = event.markPrice;
      row.rate = event.fundingRate;
    }
    if (event.t === "book") {
      row.bid = event.bids[0]?.price;
      row.ask = event.asks[0]?.price;
    }
  },
  onStatusChange: (status) => console.log(`\n>>> ${new Date().toISOString()} 行情状态：${status}\n`),
});

const timer = setInterval(() => {
  const lines = [...rows].map(
    ([symbol, r]) =>
      `${symbol.padEnd(10)} 最新 ${show(r.last).padStart(14)}  标记 ${show(r.mark).padStart(14)}  买一 ${show(r.bid).padStart(14)}  卖一 ${show(r.ask).padStart(14)}  费率 ${show(r.rate, 6).padStart(10)}`,
  );
  console.log(
    `\n${new Date().toISOString()}  状态 ${feed.status()}（public ${feed.connectionState("public")} / market ${feed.connectionState("market")}）\n${lines.join("\n")}`,
  );
}, 1000);

process.on("SIGINT", () => {
  clearInterval(timer);
  feed.stop();
  process.exit(0);
});
