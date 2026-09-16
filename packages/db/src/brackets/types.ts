/**
 * 分层表的一层，数值用十进制字符串。
 *
 * 为什么不直接用 bigint：这个形状要进 JSON（变更记录的 jsonb、日志、报告），
 * 而 bigint 不许直接进 JSON。需要算的时候再用 shared 的 parse() 转成 Fixed。
 */
export interface BracketRow {
  bracket: number; // 层号，从 1 开始
  notionalFloor: string; // 名义价值下限
  notionalCap: string; // 名义价值上限
  maxLeverage: number; // 这一层允许的最大杠杆（整数倍数，不是金额）
  mmr: string; // 维持保证金率，小数形式："0.004" 即 0.4%
  cum: string; // 速算额
}
