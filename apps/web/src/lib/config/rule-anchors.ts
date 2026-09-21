import type { Route } from "next";

/**
 * 规则页（`/rules`）里可以被别处直接跳过去的段落。
 *
 * 界面上那些 `?` 就是跳这儿的：盘口的"只用真实深度"、委托表的"前方排队"、
 * 账户的"保证金率"、行情条的"资金费率"，解释都在规则页，不在 tooltip 里挤。
 *
 * 放在 `lib/` 而不是 `app/rules/` 下面：`components/` 里的通用组件不许 import `app/`，
 * 但它要用这些锚点。规则页那边的段落表（`app/rules/_lib/sections.ts`）拿这份当准绳，
 * 有测试盯着"每个锚点都得有对应的段落"，不会出现点了跳到页面顶部的死链接。
 */
export const RULE_ANCHORS = {
  /** 和真实交易所的差别（失真点总表） */
  differences: "differences",
  /** 为什么盘口只有这么多档、市价单为什么会被拒 */
  depth: "depth",
  /** 前方排队是怎么估出来的 */
  queue: "queue",
  /** 强平怎么算、怎么执行 */
  liquidation: "liquidation",
  /** 资金费什么时候结算、怎么算 */
  funding: "funding",
  /** 账户重置做了什么、有什么影响 */
  reset: "reset",
} as const;

export type RuleAnchor = keyof typeof RULE_ANCHORS;

/** Next 16 的类型化路由推不出带 hash 的模板字面量，断言收在这一处 */
export const ruleHref = (anchor: RuleAnchor): Route => `/rules#${RULE_ANCHORS[anchor]}` as Route;
