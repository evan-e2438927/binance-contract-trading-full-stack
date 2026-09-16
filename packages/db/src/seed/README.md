# leverage-brackets.json 填写说明

**这个文件的数字必须从币安 App / 官网的"杠杆分层标准"页面人工核对，不允许由 AI 凭训练数据生成。**

## 格式

\`\`\`json
{
  "BTCUSDT": [
    { "bracket": 1, "notionalFloor": "0", "notionalCap": "50000", "maxLeverage": 125, "mmr": "0.004", "cum": "0" },
    { "bracket": 2, "notionalFloor": "50000", "notionalCap": "250000", "maxLeverage": 100, "mmr": "0.005", "cum": "50" }
  ]
}
\`\`\`

- 所有数值字段用十进制**字符串**（导入脚本会用 packages/shared 的 parse() 转成定标 1e8 的 bigint）。
- mmr 是维持保证金率的小数形式：币安页面写"0.4%"就填 "0.004"。
- cum 是速算额，币安页面直接给。
- 每个币对的层按 bracket 从 1 开始升序排列，跟币安页面顺序一致。

## 核对步骤（每个币对）

1. 打开币安 App/官网的杠杆分层表页面，找到对应合约。
2. 逐层抄 Notional Cap、Max Leverage、Maintenance Margin Rate、Maintenance Amount（= cum）。
3. 填完一个币对，跑一次 `pnpm --filter @binance-contract-trading-full-stack/db run verify:brackets`，确认这个币对显示 ✓。
4. 全部 20 个开放币对填完、全部 ✓ 之后，才能跑 seed:brackets 导入数据库。