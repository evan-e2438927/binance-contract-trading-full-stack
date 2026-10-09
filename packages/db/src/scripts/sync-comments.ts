import "varlock/auto-load";
import { Project, SyntaxKind, Node } from "ts-morph";
import { is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../schema";
import { createDb } from "../index";
import { ENV } from "../env";

/**
 * 把 schema 源码里 pgTable 定义上方的 /** *\/ 注释同步成 Postgres 的 COMMENT ON TABLE/COLUMN。
 *
 * 用法：
 *   pnpm --filter @binance-contract-trading-full-stack/db run sync-comments
 */

// 取节点上方最近的 /** */ 注释，压成一行
function readDoc(node: Node) {
  const raw = node.getLeadingCommentRanges()
    .map((r) => r.getText())
    .filter((t) => t.startsWith("/**"))
    .pop();
  if (!raw) return;
  return raw
    .replace(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  const db = createDb({ DATABASE_URL: ENV.DATABASE_URL });
  const statements: string[] = [];

  const project = new Project();
  project.addSourceFilesAtPaths("src/schema/**/*.ts");

  for (const file of project.getSourceFiles()) {
    for (const decl of file.getVariableDeclarations()) {
      const table = (schema as any)[decl.getName()];
      if (!is(table, PgTable)) continue;

      const cfg = getTableConfig(table);
      const tableName = cfg.schema ? `"${cfg.schema}"."${cfg.name}"` : `"${cfg.name}"`;

      // 表注释：写在 export const xxx = pgTable(...) 上方
      const stmt = decl.getVariableStatement();
      const tableDoc = stmt && readDoc(stmt);
      if (tableDoc) statements.push(`COMMENT ON TABLE ${tableName} IS ${quote(tableDoc)}`);

      // 列注释：pgTable 第二个参数里每个字段上方
      const columns = decl
        .getInitializerIfKind(SyntaxKind.CallExpression)
        ?.getArguments()[1]
        ?.asKind(SyntaxKind.ObjectLiteralExpression);

      for (const prop of columns?.getProperties() ?? []) {
        const p = prop.asKind(SyntaxKind.PropertyAssignment);
        const doc = p && readDoc(p);
        const column = p && (table as unknown as Record<string, { name: string }>)[p.getName()];
        if (!doc || !column) continue;
        statements.push(`COMMENT ON COLUMN ${tableName}."${column.name}" IS ${quote(doc)}`);
      }
    }
  }

  try {
    for (const s of statements) await db.execute(sql.raw(s));
    console.log(`已同步 ${statements.length} 条注释`);
  } finally {
    await db.$client.end();
  }
}

main();
