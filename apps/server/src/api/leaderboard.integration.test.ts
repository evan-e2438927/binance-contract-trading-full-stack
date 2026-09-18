import { equitySnapshots, fills } from "@binance-contract-trading-full-stack/db";
import { divRound, parse } from "@binance-contract-trading-full-stack/shared";
import { and, eq, gt } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { toDecimal } from "../http/decimal";
import { takeEquitySnapshot } from "../jobs/equity-snapshot";
import { createTestDb, marketOrder, setupApi } from "../testing/api-harness";

/**
 * 第 13b 讲验收：每日权益快照 → 排行榜 / 权益曲线。口径是用户 2026-09-17 定的：
 * 期初权益为分母、统计期内重置过不上日榜周榜；胜率按平仓成交；错过快照不补；至少一笔成交才上榜。
 *
 * 时间放在 2099 年：本地库里以后真的跑出每日快照，也不会比测试的日期更新，排行榜的 asOf 一定是测试这几天。
 */

const testDb = createTestDb();
afterAll(testDb.close);

const DAY1 = Date.parse("2099-01-01T00:00:00Z");
const DAY2 = Date.parse("2099-01-02T00:00:00Z");
const HOUR = 3_600_000;

describe("权益快照与排行榜（第 13b 讲验收）", () => {
  it("★ 快照 → 日榜 / 总榜 / 周榜 / 我的名次 / 权益曲线，按定下的口径", async () => {
    await testDb.inRollback(async (tx) => {
      const h = await setupApi(tx, { startMs: DAY1 - HOUR });
      const { api, clock, setBook, setMark, host, ready } = h;
      const winner = await h.newAccount("winner");
      const loser = await h.newAccount("loser");
      const idle = await h.newAccount("idle"); // 从不交易
      const resetter = await h.newAccount("resetter"); // 交易过，日内重置
      const snapshot = (at: number) => takeEquitySnapshot({ db: tx, host, isSymbolReady: (s) => ready.has(s), at });

      // DAY1 00:00 快照：四个人都是 10,000
      clock.t = DAY1;
      const first = await snapshot(DAY1);
      expect(first.skipped).toEqual([]);
      const mine = [winner.id, loser.id, idle.id, resetter.id];
      const day1Rows = (await tx.select().from(equitySnapshots).where(eq(equitySnapshots.snapDate, "2099-01-01"))).filter((r) => mine.includes(r.accountId));
      expect(day1Rows.map((r) => [r.equity, r.cumulativePnl, r.roi])).toEqual(Array(4).fill([parse("10000"), 0n, 0n]));

      // DAY1 白天：winner 做多、loser 做空，价格涨上去之后各平一半；resetter 开仓后重置
      clock.t = DAY1 + HOUR;
      await api("POST", "/orders", { token: winner.token, body: marketOrder("BUY", "0.1") });
      await api("POST", "/orders", { token: loser.token, body: marketOrder("SELL", "0.1") });
      await api("POST", "/orders", { token: resetter.token, body: marketOrder("BUY", "0.02") });
      clock.t = DAY1 + 2 * HOUR;
      await api("POST", "/account/reset", { token: resetter.token });
      clock.t = DAY1 + 3 * HOUR;
      await setBook([["50999.9", "5"]], [["51000", "5"]]);
      await setMark("51000");
      expect((await api("POST", "/orders", { token: winner.token, body: marketOrder("SELL", "0.05") })).json.data.status).toBe("FILLED");
      expect((await api("POST", "/orders", { token: loser.token, body: marketOrder("BUY", "0.05") })).json.data.status).toBe("FILLED");

      // DAY2 00:00 快照
      clock.t = DAY2;
      await snapshot(DAY2);
      const day2 = new Map((await tx.select().from(equitySnapshots).where(eq(equitySnapshots.snapDate, "2099-01-02"))).map((r) => [r.accountId, r]));
      const eq2 = (id: string) => day2.get(id)!.equity;
      expect(eq2(winner.id) > parse("10000")).toBe(true);
      expect(eq2(loser.id) < parse("10000")).toBe(true);
      // 快照的 ROI = (权益 − 10,000) ÷ 10,000
      expect(day2.get(winner.id)!.roi).toBe(divRound(eq2(winner.id) - parse("10000"), parse("10000")));

      // ── 日榜：(DAY2 权益 − DAY1 权益) ÷ DAY1 权益；idle 没成交不上榜；resetter 期内重置过不上榜
      const daily = (await api("GET", "/leaderboard?period=daily")).json.data;
      expect(daily).toMatchObject({ period: "daily", asOf: "2099-01-02", since: "2099-01-01" });
      const dailyMine = daily.items.filter((i: any) => ["winner", "loser", "idle", "resetter"].includes(i.nickname));
      expect(dailyMine.map((i: any) => i.nickname)).toEqual(["winner", "loser"]);
      const [w, l] = dailyMine;
      expect(parse(w.roi)).toBe(divRound(eq2(winner.id) - parse("10000"), parse("10000")));
      expect(w.rank < l.rank).toBe(true);
      // 胜率：winner 1 笔平仓成交赚钱 → 1；loser 1 笔亏钱 → 0；成交次数 2（开仓 + 平仓）
      expect([w.winRate, w.tradeCount, l.winRate, l.tradeCount]).toEqual(["1", 2, "0", 2]);

      // ── 总榜：快照 ROI，resetter 上榜（交易过），统计期从重置算起——重置之后没成交，成交次数 0、胜率 null
      const all = (await api("GET", "/leaderboard?period=all", { token: loser.token })).json.data;
      const allMine = all.items.filter((i: any) => ["winner", "loser", "idle", "resetter"].includes(i.nickname));
      expect(allMine.map((i: any) => i.nickname)).toEqual(["winner", "resetter", "loser"]);
      expect(allMine.find((i: any) => i.nickname === "resetter")).toMatchObject({ roi: "0", equity: "10000", tradeCount: 0, winRate: null });
      expect(all.myRank).toMatchObject({ nickname: "loser", rank: allMine[2].rank });

      // 没资格上榜的人查 myRank：null
      expect((await api("GET", "/leaderboard?period=daily", { token: idle.token })).json.data.myRank).toBeNull();
      expect((await api("GET", "/leaderboard?period=daily", { token: "broken" })).json.error.code).toBe("UNAUTHORIZED");

      // ── 周榜：DAY2 往前 7 天没有快照 → 没人
      const weekly = (await api("GET", "/leaderboard?period=weekly")).json.data;
      expect(weekly).toMatchObject({ since: "2098-12-26" });
      expect(weekly.items.filter((i: any) => ["winner", "loser"].includes(i.nickname))).toEqual([]);

      // ── 权益曲线：两天快照 + 当前实时权益
      const curve = (await api("GET", "/account/equity-curve?days=30", { token: winner.token })).json.data;
      expect(curve.snapshots.map((s: any) => [s.date, s.equity])).toEqual([
        ["2099-01-01", "10000"],
        ["2099-01-02", toDecimal(eq2(winner.id))],
      ]);
      expect(curve.current).toMatchObject({ time: DAY2 });
      expect(parse(curve.current.equity)).toBe(eq2(winner.id)); // 快照之后价格没动
      expect((await api("GET", "/account/equity-curve?days=0", { token: winner.token })).json.error.code).toBe("INVALID_PARAMS");

      // 独立核对胜率口径：winner 在统计期里的平仓成交确实只有 1 笔、而且赚钱
      const winnerFills = await tx.select().from(fills).where(and(eq(fills.accountId, winner.id), gt(fills.createdAt, new Date(DAY1))));
      expect(winnerFills.filter((f) => f.realizedPnl !== 0n).map((f) => f.realizedPnl > 0n)).toEqual([true]);
    });
  });

  it("快照跳过拍不了的账户：仓位所在币对行情没就绪 → 不写这个账户，不拿断线前的旧标记价凑数；同一天重复拍不覆盖", async () => {
    await testDb.inRollback(async (tx) => {
      const h = await setupApi(tx, { startMs: DAY1 - HOUR });
      const holder = await h.newAccount("holder");
      const flat = await h.newAccount("flat");
      await h.api("POST", "/orders", { token: holder.token, body: marketOrder("BUY", "0.1") });

      h.ready.delete("BTCUSDT"); // 断线
      const report = await takeEquitySnapshot({ db: tx, host: h.host, isSymbolReady: (s) => h.ready.has(s), at: DAY1 });
      expect(report.skipped.find((s) => s.accountId === holder.id)).toEqual({ accountId: holder.id, reason: "BTCUSDT 行情未就绪" });
      const rows = await tx.select().from(equitySnapshots).where(eq(equitySnapshots.snapDate, "2099-01-01"));
      expect(rows.some((r) => r.accountId === holder.id)).toBe(false);
      expect(rows.find((r) => r.accountId === flat.id)?.equity).toBe(parse("10000"));

      // 同一天再拍一次：flat 在两次之间交易过（手续费让权益变了），已有的那条不覆盖；上次被跳过的 holder 这次补上
      h.ready.add("BTCUSDT");
      await h.setMark("50000");
      await h.api("POST", "/orders", { token: flat.token, body: marketOrder("BUY", "0.1") });
      expect((await h.host.read((engine) => engine.accountView(flat.id)))!.marginBalance).not.toBe(parse("10000"));
      await takeEquitySnapshot({ db: tx, host: h.host, isSymbolReady: (s) => h.ready.has(s), at: DAY1 });
      const again = await tx.select().from(equitySnapshots).where(eq(equitySnapshots.snapDate, "2099-01-01"));
      expect(again.filter((r) => r.accountId === flat.id).map((r) => r.equity)).toEqual([parse("10000")]);
      expect(again.some((r) => r.accountId === holder.id)).toBe(true);
    });
  });

  it("还没有任何快照时：排行榜为空，asOf 为 null", async () => {
    await testDb.inRollback(async (tx) => {
      await tx.delete(equitySnapshots); // 事务最终回滚，不影响库里真实数据
      const h = await setupApi(tx);
      expect((await h.api("GET", "/leaderboard")).json.data).toEqual({ period: "all", asOf: null, since: null, items: [], myRank: null });
    });
  });
});
