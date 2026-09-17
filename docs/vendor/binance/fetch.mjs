// 拉取币安开发者文档的纯文本全集到本地，并拆出 U 本位合约部分。
// 用法：pnpm run docs:binance
//
// 产物（都不进 git，见 .gitignore）：
//   llms-full.txt     币安所有产品线的文档原文，约 8 MB
//   usds-futures.txt  只含 U 本位合约（/products/derivatives-trading-usds-futures/）的章节，开头带拉取时间
//   rest-api/*.md     U 本位合约 REST 接口的参数说明，来自币安官方 Go SDK（binance/binance-connector-go），
//                     和网页版 API Reference 出自同一份 OpenAPI 定义，但没有默认值和接口下方的备注
//
// llms-full.txt 不包含 REST 接口的逐个参数说明，所以另外拉 rest-api/。详见同目录 README.md。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://developers.binance.com/en/docs/llms-full.txt";
const SECTION_PREFIX = "/products/derivatives-trading-usds-futures/";
const dir = dirname(fileURLToPath(import.meta.url));

// 不带浏览器 User-Agent 时，币安文档站可能返回空内容
const response = await fetch(SOURCE, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    Accept: "text/plain,*/*",
  },
});
if (!response.ok) {
  throw new Error(`拉取失败：HTTP ${response.status}`);
}
const full = await response.text();
// 拿到的不是文档（空内容、被拦截的网页）就不覆盖本地旧文件
if (!full.startsWith("# Binance Developer Docs") || full.length < 1_000_000) {
  throw new Error(`内容不像币安文档全集（长度 ${full.length}），不覆盖本地文件`);
}
writeFileSync(join(dir, "llms-full.txt"), full);

// 按 "## Document: <路径>" 切段，只留 U 本位合约的
const sections = full.split(/^(?=## Document: )/m);
const futures = sections.filter((section) => section.startsWith(`## Document: ${SECTION_PREFIX}`));
if (futures.length === 0) {
  throw new Error(`没找到 ${SECTION_PREFIX} 开头的章节，币安可能改了文档结构`);
}

const fetchedAt = new Date().toISOString();
const header = [
  "# 币安 U 本位合约文档（从 llms-full.txt 拆出）",
  "",
  `> 来源：${SOURCE}`,
  `> 拉取时间：${fetchedAt}`,
  `> 章节数：${futures.length}`,
  "",
  futures.map((section) => `- ${section.split("\n", 1)[0].replace("## Document: ", "")}`).join("\n"),
  "",
  "---",
  "",
].join("\n");
writeFileSync(join(dir, "usds-futures.txt"), header + futures.join(""));

console.log(`llms-full.txt：${(full.length / 1e6).toFixed(1)} MB，${sections.length - 1} 个章节`);
console.log(`usds-futures.txt：${futures.length} 个章节`);

// REST 接口参数说明：币安官方 Go SDK 生成的 Markdown（网页版的 schema.yaml 有防爬虫校验，不绕过）
const SDK_DOCS =
  "https://raw.githubusercontent.com/binance/binance-connector-go/main/clients/derivativestradingusdsfutures/src/restapi/docs";
const REST_FILES = ["TradeAPI", "AccountAPI", "MarketDataAPI", "UserDataStreamsAPI", "ConvertAPI", "PortfolioMarginEndpointsAPI"];
const restDir = join(dir, "rest-api");
mkdirSync(restDir, { recursive: true });
for (const name of REST_FILES) {
  const res = await fetch(`${SDK_DOCS}/${name}.md`);
  if (!res.ok) throw new Error(`拉取 ${name}.md 失败：HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(join(restDir, `${name}.md`), text);
  console.log(`rest-api/${name}.md：${(text.length / 1e3).toFixed(0)} KB`);
}
