import { z } from "zod";

/** 数值一律十进制字符串，导入脚本用 shared 的 parse() 转成 Fixed。 */
export const BracketRowSchema = z.object({
  bracket: z.number().int().min(1),
  notionalFloor: z.string(),
  notionalCap: z.string(),
  maxLeverage: z.number().int().min(1),
  mmr: z.string(),
  cum: z.string(),
});

export type BracketRow = z.infer<typeof BracketRowSchema>;

/** 文件整体：symbol → 按 bracket 升序排列的分层数组。 */
export const LeverageBracketFileSchema = z.record(
  z.string(),
  z.array(BracketRowSchema),
);

export type LeverageBracketFile = z.infer<typeof LeverageBracketFileSchema>;
