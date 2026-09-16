# leverage-brackets.json 填写说明

**这个文件的数字必须来自币安本身，不允许由 AI 凭训练数据生成。**

这条规则的理由：抄错一档不会让 `verify:brackets` 报错——连续性校验只能发现相邻两层在
边界上不衔接，发现不了整体抄错一档——但会让这个币对的所有强平价系统性偏移。

有两条满足这条规则的路径，**优先用第一条**。

---

## 路径一（推荐）：`fetch:brackets` 拉取

```bash
pnpm --filter @binance-contract-trading-full-stack/db run fetch:brackets
# 或只拉指定币对
pnpm --filter @binance-contract-trading-full-stack/db run fetch:brackets BTCUSDT ETHUSDT
```

数据来自币安网页端自己的返回，不是凭记忆写的数字，而且消除了手抄环节的笔误。
开放哪些币对，改 `src/scripts/fetch-brackets.ts` 里的 `DEFAULT_SYMBOLS`。

**两个必须知道的前提：**

1. 这个接口是币安网页端用的 bapi，**不在官方 API 文档里**，可能随时改结构或下线。
   脚本对返回做了严格校验（字段缺失、数值带浮点尾巴、层号不连续、连续性不过一律抛错
   中止，不写文件），所以它挂掉的时候会明确报错，而不是悄悄写出一份烂数据。真挂了就
   走下面的路径二。
2. 脚本消除的是**抄写错误**，不是"数据源可能不对"这个风险。跑完请抽查几个币对，
   对照币安 App 的「杠杆分层标准」页面核一遍再 `seed:brackets`。

---

## 路径二（兜底）：人工核对填写

接口不可用时走这条。

1. 打开币安 App / 官网的杠杆分层表页面，找到对应合约。
2. 逐层抄 Notional Cap、Max Leverage、Maintenance Margin Rate、Maintenance Amount（= cum）。
3. 填完一个币对，跑一次 `verify:brackets`，确认这个币对显示 ✓。
4. 全部开放币对填完、全部 ✓ 之后，才能跑 `seed:brackets` 导入数据库。

---

## 格式

```json
{
  "BTCUSDT": [
    { "bracket": 1, "notionalFloor": "0", "notionalCap": "300000", "maxLeverage": 150, "mmr": "0.004", "cum": "0" },
    { "bracket": 2, "notionalFloor": "300000", "notionalCap": "800000", "maxLeverage": 100, "mmr": "0.005", "cum": "300" }
  ]
}
```

- 所有数值字段用十进制**字符串**（导入脚本会用 packages/shared 的 `parse()` 转成定标 1e8 的 bigint）。
- `mmr` 是维持保证金率的小数形式：币安页面写 "0.4%" 就填 `"0.004"`。
- `cum` 是速算额，币安页面直接给。
- 每个币对的层按 `bracket` 从 1 开始升序排列，跟币安页面顺序一致。

> 上面这段 BTCUSDT 是 2026-09 的实际数值。`docs/design/03-database-design.md` 里的例子
> （10 层、最高 125x）是更早的版本，已经过时，不要照着它填。
