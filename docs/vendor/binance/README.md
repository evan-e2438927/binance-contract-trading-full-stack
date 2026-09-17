# 币安文档本地副本

币安开发者文档的本地副本，方便查阅和开发时对照。**文件本身不进 git**（`.gitignore` 忽略了本目录的 `*.txt`），需要时自己拉：

```bash
pnpm run docs:binance
```

| 文件 | 内容 | 大小 |
| --- | --- | --- |
| `llms-full.txt` | 币安所有产品线的文档原文（来源 `https://developers.binance.com/en/docs/llms-full.txt`） | 约 8 MB |
| `usds-futures.txt` | 从上面拆出的 U 本位合约部分，开头写了拉取时间和章节目录 | 约 200 KB |
| `rest-api/*.md` | U 本位合约 REST 接口的参数说明（下单、仓位、杠杆、行情……），来自币安官方 Go SDK `binance/binance-connector-go` | 约 220 KB |

## `usds-futures.txt` 里有什么

13 个章节：通用信息（含请求限制）、**错误码**、公共定义（枚举值）、**更新日志**、用户数据流、WebSocket 行情流、STP 说明等。

查错误码直接搜编号，比如 `-2027`。只搜 `usds-futures.txt`，不要搜全集——现货、钱包等产品线有同编号但意思不同的错误码。

## `rest-api/` 里有什么

`TradeAPI.md` 最常用：下单（`NewOrder`）、条件单（`NewAlgoOrder`）、撤单、调杠杆（`ChangeInitialLeverage`）、切保证金模式、切持仓模式、仓位查询（`PositionInformationV3`）……每个接口有一张参数表，"Description" 一栏就是币安网页版的参数说明原文（HTML 转义过，`&#x60;` 是反引号）。

币安 SDK 是用网页版 API Reference 同一份 OpenAPI 定义生成的，所以参数说明一致。**但缺两样东西**：

- **参数默认值**：比如 `workingType` 默认 `CONTRACT_PRICE`，这份里看不到
- **接口下方的备注**：比如条件单的触发条件、`closePosition` 的各种限制

这两样以网页版为准。网页版右上角有 "Download schema" 可以下载完整的 OpenAPI 定义（`schema.yaml`，约 600 KB），但它有防爬虫校验，脚本拉不下来。需要的话在你自己的浏览器里点下载，放到本目录（`*.yaml` 同样不进 git）。

## 里面**没有**的

`llms-full.txt` 不含 REST 接口参数说明（所以另外拉了 `rest-api/`）；`rest-api/` 不含默认值和备注。这部分看网页版 API Reference，要用浏览器打开：

- U 本位合约交易接口：`https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order`

公式类说明（开仓成本、强平价、资金费）在币安 FAQ（`https://www.binance.com/en/support/faq/...`），同样要用浏览器打开。

已经核对过的规则汇总在 `docs/design/07-binance-reference.md`，查规则先看那份。
