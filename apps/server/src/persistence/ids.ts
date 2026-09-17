import { createHash } from "node:crypto";

/**
 * 引擎 id → 数据库 uuid（设计缺口 #8）。
 *
 * 引擎里的 id 是确定性字符串，为了可重放：成交 `订单id:1` / `订单id:t归集成交id`、强平 `liq:账户:币对:方向:时间`、
 * 资金费 `funding:账户:币对:方向:时间`。数据库里这些表的 id 列是 uuid。
 *
 * 做法：本来就是 uuid 的（宿主生成的订单 id、账户 id）原样用；其它按 **UUID v5**（RFC 9562 第 5.5 节，
 * 命名空间 + 名字 → SHA-1 → uuid）换算。同一个引擎 id 永远得到同一个 uuid：
 * - 成交的 order_id 外键、流水的 ref_id 各自独立换算，一定对得上
 * - 同一笔资金费重复落库会撞主键 / 唯一索引，不会悄悄多记一次
 * - 不需要一张映射表
 */

/** 本项目自己的命名空间（随机生成后固定下来，改了之后历史数据就对不上新换算的 id） */
export const ENGINE_ID_NAMESPACE = "3b8f2c1e-6a4d-4f7b-9c2e-8d5a1f0b7e63";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toDbId(engineId: string): string {
  return UUID.test(engineId) ? engineId.toLowerCase() : uuidV5(engineId, ENGINE_ID_NAMESPACE);
}

export function uuidV5(name: string, namespace: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // 版本 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 变体
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
