import { format, parse } from "@binance-contract-trading-full-stack/shared";
import { describe, expect, it } from "vitest";

import type { EquityCurve } from "@/server-api-module/account/types";

import { buildCurve } from "./curve";

const snapshot = (date: string, equity: string) => ({
  date,
  equity,
  walletBalance: equity,
  cumulativePnl: "0",
  roi: "0",
});

const curveOf = (dates: [string, string][], current: EquityCurve["current"]): EquityCurve => ({
  snapshots: dates.map(([date, equity]) => snapshot(date, equity)),
  current,
});

const NO_LIVE: EquityCurve["current"] = { equity: null, time: Date.parse("2026-09-21T03:00:00Z") };

describe("buildCurve", () => {
  it("没有任何点时返回 null（不画一条假的直线）", () => {
    expect(buildCurve(curveOf([], NO_LIVE))).toBeNull();
    expect(buildCurve(undefined)).toBeNull();
  });

  it("最低点在 0、最高点在 1", () => {
    const curve = buildCurve(
      curveOf(
        [
          ["2026-09-19", "9000"],
          ["2026-09-20", "11000"],
        ],
        NO_LIVE,
      ),
    );
    expect(curve?.points.map((p) => p.y)).toEqual([0, 1]);
    expect(format(curve?.min ?? 0n, 2)).toBe("9000.00");
    expect(format(curve?.max ?? 0n, 2)).toBe("11000.00");
  });

  it("横坐标按日期算，不按数组下标——中间缺的那天要占位置", () => {
    const curve = buildCurve(
      curveOf(
        [
          ["2026-09-19", "10000"],
          ["2026-09-21", "10000"],
        ],
        NO_LIVE,
      ),
    );
    expect(curve?.points.map((p) => p.x)).toEqual([0, 1]);
  });

  it("缺了一天就断开，不插值", () => {
    const curve = buildCurve(
      curveOf(
        [
          ["2026-09-18", "10000"],
          ["2026-09-19", "10100"],
          // 9-20 没拍到
          ["2026-09-21", "10200"],
        ],
        NO_LIVE,
      ),
    );
    expect(curve?.segments).toHaveLength(2);
    expect(curve?.segments[0]?.map((p) => p.date)).toEqual(["2026-09-18", "2026-09-19"]);
    expect(curve?.segments[1]?.map((p) => p.date)).toEqual(["2026-09-21"]);
  });

  it("连续的日子连成一段", () => {
    const curve = buildCurve(
      curveOf(
        [
          ["2026-09-19", "10000"],
          ["2026-09-20", "10100"],
          ["2026-09-21", "10200"],
        ],
        NO_LIVE,
      ),
    );
    expect(curve?.segments).toHaveLength(1);
    expect(curve?.segments[0]).toHaveLength(3);
  });

  it("此刻的实时权益接在最右端，标成 live", () => {
    const curve = buildCurve(
      curveOf([["2026-09-20", "10000"]], { equity: "12000", time: Date.parse("2026-09-21T03:00:00Z") }),
    );
    const last = curve?.points.at(-1);
    expect(last?.live).toBe(true);
    expect(last?.date).toBeNull();
    expect(last?.x).toBe(1);
    expect(format(last?.equity ?? 0n, 2)).toBe("12000.00");
  });

  it("缺标记价时服务端给 null，只画到最后一张快照", () => {
    const curve = buildCurve(curveOf([["2026-09-20", "10000"]], NO_LIVE));
    expect(curve?.points).toHaveLength(1);
    expect(curve?.points[0]?.live).toBe(false);
  });

  it("只有一个点时摆中间，不贴着左边", () => {
    const curve = buildCurve(curveOf([["2026-09-20", "10000"]], NO_LIVE));
    expect(curve?.points[0]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("全程没波动时摆中间高度，不会除以 0", () => {
    const curve = buildCurve(
      curveOf(
        [
          ["2026-09-20", "10000"],
          ["2026-09-21", "10000"],
        ],
        NO_LIVE,
      ),
    );
    expect(curve?.points.map((p) => p.y)).toEqual([0.5, 0.5]);
    expect(curve?.min).toBe(parse("10000"));
  });

  it("日期格式不对的那条跳过，不让整张图挂掉", () => {
    const curve = buildCurve(
      curveOf(
        [
          ["坏掉的日期", "10000"],
          ["2026-09-21", "11000"],
        ],
        NO_LIVE,
      ),
    );
    expect(curve?.points).toHaveLength(1);
    expect(curve?.points[0]?.date).toBe("2026-09-21");
  });
});
