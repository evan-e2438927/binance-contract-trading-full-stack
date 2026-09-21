import { RULE_ANCHORS } from "@/lib/config/rule-anchors";

/**
 * 规则页的段落表（08 第 7 节 R-01～R-05）。目录和正文标题都从这一份生成，
 * 不会出现"目录里有、正文里没有"。
 *
 * `id` 就是锚点。`RULE_ANCHORS` 里列出来的那几个是**别的页面会跳过来**的，
 * 下面的测试盯着它们必须都在这张表里——改名字忘了改另一边，测试会红。
 */

export interface RuleSection {
  /** 锚点 id，`/rules#<id>` */
  id: string;
  /** 目录和正文里的标题 */
  title: string;
  /** 二级段落，目录里缩进显示 */
  children?: { id: string; title: string }[];
}

export const RULE_SECTIONS: RuleSection[] = [
  {
    id: RULE_ANCHORS.differences,
    title: "和真实交易所的差别",
  },
  {
    id: "matching",
    title: "撮合与排队",
    children: [
      { id: RULE_ANCHORS.depth, title: "盘口深度与市价单拒单" },
      { id: RULE_ANCHORS.queue, title: "前方排队是怎么估的" },
    ],
  },
  {
    id: "margin",
    title: "保证金、强平与资金费",
    children: [
      { id: RULE_ANCHORS.liquidation, title: "强平" },
      { id: RULE_ANCHORS.funding, title: "资金费" },
    ],
  },
  {
    id: "account",
    title: "账户与重置",
    children: [{ id: RULE_ANCHORS.reset, title: "重置模拟账户" }],
  },
];

/** 表里全部 id（含二级），给测试和目录用 */
export const allSectionIds = (): string[] =>
  RULE_SECTIONS.flatMap((section) => [section.id, ...(section.children ?? []).map((child) => child.id)]);
