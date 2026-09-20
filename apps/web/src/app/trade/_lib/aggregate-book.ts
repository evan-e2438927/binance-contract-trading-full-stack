/**
 * 盘口聚合已经移到 `packages/shared`（2026-09-20）：服务端也要用同一套算法按精度聚合再推，
 * 各写一份迟早对不上（S03 讲义）。这里只做再导出，保持原来的 import 路径不变。
 */
export {
  aggregateSide,
  bucketPrice,
  stepOptions,
  isValidStep,
  type BookLevel,
  type BookRow,
  type BookSide,
} from "@binance-contract-trading-full-stack/shared";
