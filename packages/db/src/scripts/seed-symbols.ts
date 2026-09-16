import "varlock/auto-load";
import { parse } from "@binance-contract-trading-full-stack/shared";
import { eq } from "drizzle-orm";
import { createDb } from "../index";
import { ENV } from "../env";
import { symbols, type NewSymbol } from "../schema/symbols";

const EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";

interface BinanceFilter {
  filterType: string;
  /** 每种 filter 只带自己那几个字段，取别的 key 就是 undefined——类型如实反映这一点。 */
  [key: string]: string | number | undefined;
}

interface BinanceExchangeInfoSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  pricePrecision: number;
  quantityPrecision: number;
  filters: BinanceFilter[];
}

function findFilter(filters: BinanceFilter[], filterType: string): BinanceFilter {
  const found = filters.find((f) => f.filterType === filterType);
  if (!found) {
    throw new Error(`symbol 缺少 filter: ${filterType}`);
  }
  return found;
}

/** 取 filter 里的必填字段。缺了就抛错，不拿 "undefined" 去 parse 出一个假数字。 */
function requireField(filter: BinanceFilter, key: string): string {
  const value = filter[key];
  if (value === undefined) {
    throw new Error(`filter ${filter.filterType} 缺少字段: ${key}`);
  }
  return String(value);
}

/** 纯函数：币安 exchangeInfo 的一条 symbol 记录 → 待写入 symbols 表的行。不碰网络、不碰数据库。 */
export function mapExchangeInfoSymbol(raw: BinanceExchangeInfoSymbol): NewSymbol {
  const priceFilter = findFilter(raw.filters, "PRICE_FILTER");
  const lotSizeFilter = findFilter(raw.filters, "LOT_SIZE");
  const minNotionalFilter = findFilter(raw.filters, "MIN_NOTIONAL");

  return {
    symbol: raw.symbol,
    baseAsset: raw.baseAsset,
    quoteAsset: raw.quoteAsset,
    status: raw.status,
    pricePrecision: raw.pricePrecision,
    quantityPrecision: raw.quantityPrecision,
    tickSize: parse(requireField(priceFilter, "tickSize")),
    stepSize: parse(requireField(lotSizeFilter, "stepSize")),
    minQty: parse(requireField(lotSizeFilter, "minQty")),
    minNotional: parse(requireField(minNotionalFilter, "notional")),
  };
}

async function main() {
  const res = await fetch(EXCHANGE_INFO_URL);
  if (!res.ok) {
    throw new Error(`拉取 exchangeInfo 失败: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { symbols: BinanceExchangeInfoSymbol[] };

  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  let created = 0;
  let updated = 0;

  for (const raw of body.symbols) {
    const row = mapExchangeInfoSymbol(raw);
    const existing = await db.select().from(symbols).where(eq(symbols.symbol, row.symbol)).limit(1);

    if (existing.length === 0) {
      await db.insert(symbols).values(row);
      created += 1;
    } else {
      await db
        .update(symbols)
        .set({
          baseAsset: row.baseAsset,
          quoteAsset: row.quoteAsset,
          status: row.status,
          pricePrecision: row.pricePrecision,
          quantityPrecision: row.quantityPrecision,
          tickSize: row.tickSize,
          stepSize: row.stepSize,
          minQty: row.minQty,
          minNotional: row.minNotional,
          updatedAt: new Date(),
        })
        .where(eq(symbols.symbol, row.symbol));
      updated += 1;
    }
  }

  console.log(`seed:symbols 完成：新建 ${created} 个，更新 ${updated} 个。`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}