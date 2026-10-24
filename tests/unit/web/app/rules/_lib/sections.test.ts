import { describe, expect, it } from "vitest";

import { RULE_ANCHORS, ruleHref } from "@/lib/config/rule-anchors";

import { allSectionIds, RULE_SECTIONS } from "../../../../../../apps/web/src/app/rules/_lib/sections";

describe("规则页段落表", () => {
  it("别处 `?` 用到的每个锚点，规则页都有对应段落（不会点了跳到页面顶部）", () => {
    const ids = allSectionIds();
    for (const anchor of Object.values(RULE_ANCHORS)) expect(ids).toContain(anchor);
  });

  it("锚点不重复", () => {
    const ids = allSectionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个段落都有标题", () => {
    for (const section of RULE_SECTIONS) {
      expect(section.title).not.toBe("");
      for (const child of section.children ?? []) expect(child.title).not.toBe("");
    }
  });

  it("ruleHref 拼出 /rules#<锚点>", () => {
    expect(ruleHref("queue")).toBe("/rules#queue");
  });
});
