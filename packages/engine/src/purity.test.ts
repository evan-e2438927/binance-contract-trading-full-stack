import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = import.meta.dirname;

// 每一条都对应 CLAUDE.md 硬约束 #2 里的一项禁令
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bDate\.now\(/, // 时钟：时间戳必须从 EngineInput.ts 带进来
  /\bnew Date\(/, // 同上，new Date() 也是读时钟
  /\bMath\.random\(/, // 随机数：同一串输入必须得到同一串输出
  /\bcrypto\.randomUUID\(/, // 同上，订单 id 由宿主生成后放进输入
  /\bconsole\./, // 日志是宿主的事
  /\bsetTimeout\(/, // 定时器：资金费的定时在宿主层
  /\bsetInterval\(/,
  /from\s+["']node:/, // 任何 Node 内置模块（fs/net/crypto…）
  /from\s+["']drizzle-orm/, // 数据库
  /from\s+["']pg["']/,
  /from\s+["']@binance-contract-trading-full-stack\/db/, // 依赖方向：engine 不许依赖 db
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("引擎纯净性（CLAUDE.md 硬约束 #2）", () => {
  it("源码里没有时钟、随机数、IO、日志，也没有反向依赖", () => {
    const files = collectSourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(content), `${file} 命中禁止模式 ${pattern}`).toBe(false);
      }
    }
  });
});
