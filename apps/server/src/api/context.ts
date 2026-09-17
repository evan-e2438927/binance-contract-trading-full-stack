import type { DbExecutor } from "@binance-contract-trading-full-stack/db";
import type { EngineEvent, EngineInput, SymbolSpec } from "@binance-contract-trading-full-stack/engine";
import { AppError } from "@binance-contract-trading-full-stack/shared";
import type { EngineHost } from "../engine-host/engine-host";

/** 交易 / 账户接口共用的依赖 */
export interface ApiDeps {
  db: DbExecutor;
  host: EngineHost;
  /** 引擎配置里的全部币对（含已下架但还有旧仓位 / 挂单的，第 11 讲） */
  symbols: readonly SymbolSpec[];
  jwtSecret: string;
  now: () => number;
}

/** 提交给引擎；业务拒绝（rejected 事件）翻译成 AppError，由统一错误处理返回错误码 */
export async function submitOrThrow(host: EngineHost, input: EngineInput): Promise<EngineEvent[]> {
  const events = await host.submit(input);
  const rejected = events.find((e) => e.t === "rejected" && e.input === input.t);
  if (rejected && rejected.t === "rejected") throw new AppError(rejected.code, rejected.message);
  return events;
}

/**
 * 下单要求币对开放且在交易（校验链第 1 步）。在 REST 层先挡一道：引擎对"配置里根本没有的币对"是按接线错误抛异常的，
 * 宿主的行情门控又会把未知币对报成 MARKET_NOT_READY——两个都不是用户该看到的错误。
 */
export function requireTradableSymbol(symbols: readonly SymbolSpec[], symbol: string): SymbolSpec {
  const spec = symbols.find((s) => s.symbol === symbol);
  if (!spec || !spec.enabled || spec.status !== "TRADING") {
    throw new AppError("SYMBOL_NOT_TRADING", `${symbol} 不存在或未开放交易`);
  }
  return spec;
}

/** 撤单、调杠杆这类操作：币对只要在配置里就行（已下架币对上的旧挂单也要能撤） */
export function requireKnownSymbol(symbols: readonly SymbolSpec[], symbol: string): SymbolSpec {
  const spec = symbols.find((s) => s.symbol === symbol);
  if (!spec) throw new AppError("SYMBOL_NOT_TRADING", `${symbol} 不存在`);
  return spec;
}
