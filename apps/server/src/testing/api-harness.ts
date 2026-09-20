import "varlock/auto-load";
import { createDb, type DbExecutor } from "@binance-contract-trading-full-stack/db";
import { createEngine, type Engine, type EngineInput, type Level } from "@binance-contract-trading-full-stack/engine";
import { parse, type PositionMode } from "@binance-contract-trading-full-stack/shared";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { createApp } from "../app";
import { signToken } from "../auth/tokens";
import { createEngineHost } from "../engine-host/engine-host";
import { createAccountRegistrar } from "../engine-host/register-account";
import type { BinanceRest } from "../market/binance-rest";
import { createMarketState, type MarketState } from "../market/market-state";
import { loadEngineConfig, loadEngineSnapshot } from "../persistence/load";
import { persistEvents } from "../persistence/persist";

/**
 * 接口集成测试的脚手架（第 13a / 13b 讲共用）：
 * 真数据库（整个用例包在最终回滚的事务里）+ 真引擎 + 真宿主 + createApp（和线上同一套路由、中间件、错误处理）。
 * 行情是假的：默认 BTCUSDT 一份固定盘口、标记价 50,000；交易规则和分层表是库里从币安同步来的真实数据。
 */

export const JWT_SECRET = "api-integration-test-secret-0123456789abcdef";
export const quiet = { log: () => {}, error: () => {} };
export const levels = (rows: [string, string][]): Level[] => rows.map(([p, q]) => ({ price: parse(p), qty: parse(q) }));

class Rollback extends Error {}

/** 测试文件里：const testDb = createTestDb(); afterAll(testDb.close) */
export function createTestDb() {
  const db = createDb({ DATABASE_URL: process.env.DATABASE_URL! });
  return {
    db,
    close: () => db.$client.end(),
    async inRollback(fn: (tx: DbExecutor) => Promise<void>): Promise<void> {
      try {
        await db.transaction(async (tx) => {
          await fn(tx);
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    },
  };
}

const unexpected = async (): Promise<never> => {
  throw new Error("这组测试不该请求币安");
};

export interface HarnessOptions {
  /** 起始时间，默认 Date.now() */
  startMs?: number;
  /** 哪些币对行情就绪，默认只有 BTCUSDT。测试里可以随时增删 */
  ready?: Set<string>;
  binanceRest?: BinanceRest;
  marketState?: MarketState;
  clientIp?: (c: Context) => string | null;
}

export async function setupApi(tx: DbExecutor, options: HarnessOptions = {}) {
  const config = await loadEngineConfig(tx);
  const engine: Engine = createEngine(config, await loadEngineSnapshot(tx));
  const modes = new Map<string, PositionMode>(engine.snapshot().accounts.map((a) => [a.id, a.positionMode]));
  const clock = { t: options.startMs ?? Date.now() };
  const now = () => clock.t;
  const ready = options.ready ?? new Set(["BTCUSDT"]);
  const marketState = options.marketState ?? createMarketState();
  const registrar = createAccountRegistrar({ submit: (input) => host.submit(input), now });
  const host = createEngineHost({
    engine,
    isSymbolReady: (symbol) => ready.has(symbol),
    logger: quiet,
    persist: (events) =>
      persistEvents(tx, events, { positionModeOf: (id) => modes.get(id)!, pendingRegistrationOf: registrar.pendingRegistrationOf }),
    onCommitted(input, events) {
      if (input.t === "registerAccount") modes.set(input.accountId, input.positionMode);
      for (const e of events) if (e.t === "positionModeUpdate") modes.set(e.accountId, e.positionMode);
    },
  });

  const market = (input: EngineInput) => host.submit(input);
  const setBook = (bids: [string, string][], asks: [string, string][]) => market({ t: "book", symbol: "BTCUSDT", bids: levels(bids), asks: levels(asks), ts: now() });
  const setMark = (price: string) =>
    market({ t: "markPrice", symbol: "BTCUSDT", markPrice: parse(price), fundingRate: parse("0.0001"), nextFundingTs: now() + 8 * 3600_000, ts: now() });
  if (ready.has("BTCUSDT")) {
    await setBook([["49999.9", "5"], ["49999", "5"]], [["50000", "5"], ["50001", "5"]]);
    await setMark("50000");
  }

  const app = createApp({
    db: tx,
    host,
    registrar,
    symbols: config.symbols,
    feed: { status: () => "ready", symbolReady: (symbol) => ready.has(symbol) },
    marketState,
    binanceRest: options.binanceRest ?? {
      klines: unexpected,
      depthSnapshot: unexpected,
      fundingRates: unexpected,
      ticker24h: unexpected,
      ticker24hAll: unexpected,
    },
    jwtSecret: JWT_SECRET,
    webOrigin: "http://localhost:3001",
    mailer: null,
    google: null,
    secureCookies: false,
    now,
    logger: quiet,
    logRequests: false,
    clientIp: options.clientIp,
  });

  async function newAccount(nickname = "tester") {
    const id = await registrar.register({ provider: "email", providerId: `${randomUUID()}@test.local`, nickname });
    // token 用真实时间签：hono/jwt 校验 iat / exp 看的是真实时钟，按测试时钟（比如 2099 年）签会被判成"签发时间在未来"
    return { id, token: await signToken(id, JWT_SECRET, Date.now()) };
  }

  async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const res = await app.request(path, {
      method,
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, headers: res.headers, json: (await res.json()) as any };
  }

  return { config, engine, host, app, api, newAccount, clock, now, market, setBook, setMark, ready, marketState };
}

export const marketOrder = (side: "BUY" | "SELL", qty: string) => ({ symbol: "BTCUSDT", side, type: "MARKET", qty });
