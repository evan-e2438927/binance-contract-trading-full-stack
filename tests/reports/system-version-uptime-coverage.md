# 测试覆盖率报告：system-version-uptime

## 基本信息

- **迭代目录**: `docs/iterations/2026-09-24/001-system-version-uptime-feature/`
- **生成时间**: 2026-09-24
- **生成角色**: test（测试查漏）
- **测试框架**: Vitest（TEST_FRAMEWORK=vitest）
- **Lint 工具**: Biome（LINT_TOOL=biome，本次仅只读核查，未执行 `--fix`）

## 单元测试覆盖

| 测试文件 | 归属角色 | 用例数 | 结果 | 本轮变更 |
|---|---|---|---|---|
| `apps/server/src/api/system.test.ts` | backend（原有）+ test（补充 1 例） | 5（原 4 + 新增 1） | ✅ 全部通过 | 新增 `AC-002 (error, 补充)`：断言 404 响应体不泄露 `version`/`uptime`/`ok:true` |
| `apps/web/src/app/_shared/ui-components/app-header/version-info.test.ts` | frontend（原有） | 8 | ✅ 全部通过 | 无变更，覆盖已充分（比 AC-007a 要求的 2 组值多测了 6 组边界） |

实际执行命令与结果：

```
pnpm --filter server exec vitest run src/api/system.test.ts
  Test Files  1 passed (1)  |  Tests  5 passed (5)

pnpm --filter web exec vitest run src/app/_shared/ui-components/app-header/version-info.test.ts
  Test Files  1 passed (1)  |  Tests  8 passed (8)
```

### 逐条核实（不只看 `it()` 标题，逐条读断言）

| AC | 断言内容核实 | 结论 |
|---|---|---|
| AC-001 | `startedAt` 固定，`now()` 返回 `startedAt+30_000`；断言 `res.status===200` 且 `body` 深比对 `{ ok: true, data: { version: "0.1.0", uptime: 30 } }` | ✅ 覆盖，且比 AC 要求更严格（AC 允许 ±1s 误差，测试用固定时钟做到精确相等） |
| AC-002 | 原有断言只检查 `res.status===404`，未验证响应体是否泄露业务字段 | ⚠️ 原测试遗漏「不返回 `{version, uptime}` 之外的信息」这半句；**已补写** 1 个用例断言 404 响应体不含 `version`/`uptime`/`"ok":true` |
| AC-003 | `now()===startedAt`；断言 `body.data.uptime===0`、`Number.isInteger(...)===true`、`>=0` | ✅ 覆盖，非负整数三个维度都测了 |
| AC-004 | 请求未带 `Authorization` header（fetch 默认不带）；断言 `res.status===200` 且 `Object.keys(body.data).sort()===["uptime","version"]` | ✅ 覆盖：无鉴权可访问 + 字段白名单双重验证 |
| AC-007a | `formatUptime(0)==="0分钟"`；另测 59/60/3599/3600/86399/86400/90000 共 8 组边界值，且对 90000 显式断言不含 `NaN`/`-` | ✅ 覆盖，超出任务要求的最小集合 |

**发现的遗漏并已修复**：AC-002 原测试只验证了状态码，未验证「不泄露业务字段」这一半句 AC 描述。已在 `apps/server/src/api/system.test.ts` **新增**（未修改原有断言）一个用例：

```ts
it("AC-002 (error, 补充): 404 响应体不泄露 version/uptime 等业务字段", async () => {
  const startedAt = 1_700_000_000_000;
  const a = app(() => startedAt, startedAt);
  const res = await a.request("/system/version", { method: "POST" });
  const text = await res.text();
  expect(text).not.toContain("version");
  expect(text).not.toContain("uptime");
  expect(text).not.toMatch(/"ok"\s*:\s*true/);
});
```

### AC-005a（`fetchSystemVersion()` 类型与契约一致）—— 判断为不需要补测

- 现状：`apps/web/src/server-api-module/system/queries.ts` 的 `fetchSystemVersion` 是 `request.get<System>("/system/version")` 的一行纯透传，`System` 类型（`{version: string, uptime: number}`）已在 `types.ts` 与 design.md §3 接口表逐字对应，TS 编译期已保证形状。
- 先例核查：本仓库 `server-api-module` 下所有模块（`leaderboard/queries.ts`、`market/queries.ts`、`account/queries.ts` 等）均**没有**为这类一行 `request.get` 透传函数单独写运行时单测（`find apps/web/src/server-api-module -name "*.test.ts"` 结果为空）。
- 补一个 mock `request.get` 断言调用参数的单测，边际价值有限（本质是重复断言字符串字面量 `"/system/version"` 与源码相同的字符串），且会打破本项目现有惯例、引入与其他 query 模块不一致的测试密度。
- **结论：不补测**，与项目现有惯例保持一致；AC-005a 的契约一致性由 TS 类型层保证 + design.md 接口表 + `system.test.ts` 里对后端真实响应体形状的断言（AC-001/AC-004）间接交叉验证。

## Requirement → Test Matrix

| Requirement | AC | 验证方式 | 覆盖状态 | 测试位置 |
|---|---|---|---|---|
| R-001 | AC-001 happy-path | unit | ✅ 已覆盖（开发角色） | `apps/server/src/api/system.test.ts` |
| R-001 | AC-002 error | unit | ✅ 已覆盖（开发角色 + test 补 1 例） | `apps/server/src/api/system.test.ts` |
| R-001 | AC-003 boundary | unit | ✅ 已覆盖（开发角色） | `apps/server/src/api/system.test.ts` |
| R-001 | AC-004 security | unit | ✅ 已覆盖（开发角色） | `apps/server/src/api/system.test.ts` |
| R-001/R-002 | AC-005a happy-path（接口形状，T-002 任务级 AC） | unit（类型层） | ✅ 判定为类型层已充分覆盖，不补运行时单测（见上方说明） | `apps/web/src/server-api-module/system/types.ts` + `queries.ts`（TS 编译期） |
| R-002 | AC-005 happy-path（渲染） | playwright-mcp | ⏸ deferred to qa | `tests/e2e/system-version-uptime/`（qa 阶段生成） |
| R-002 | AC-006 error（渲染降级） | playwright-mcp | ⏸ deferred to qa | 同上 |
| R-002 | AC-007 boundary（渲染，对应格式化子集 AC-007a 已单测覆盖） | playwright-mcp | ⏸ deferred to qa（格式化逻辑本身 AC-007a 已 unit 覆盖） | 格式化逻辑：`version-info.test.ts`；渲染层：qa 阶段 |
| R-002 | AC-008 ui-state | playwright-mcp | ⏸ deferred to qa | 同上 |

## E2E / 浏览器验收覆盖（deferred to qa）

以下 AC 按 requirements.md 标注验证方式为 `playwright-mcp`，本阶段（test track）**不编写**任何测试，按角色说明与工作包要求登记为 `deferred to qa`，由 `qa` 命令后续生成 `tests/e2e/system-version-uptime/E2E-*.e2e.ts` 并执行：

| AC | 场景维度 | 说明 |
|---|---|---|
| AC-005 | happy-path | 顶栏渲染完成后可见 `v{version} · 运行 {格式化文案}`，选择器 `data-testid="system-version-info"` |
| AC-006 | error | 接口失败（5xx/超时）时该区域显示 `"—"`，不抛未捕获异常，其余顶栏元素正常渲染 |
| AC-007 | boundary（渲染层） | `uptime=0` 时渲染层显示"0分钟"而非"—"（格式化逻辑子集 AC-007a 已被 unit 覆盖，渲染集成仍需 qa） |
| AC-008 | ui-state | 请求 pending 时显示"—"占位，不显示 `undefined`/`NaN`，成功后替换为实际值 |

对应 tasks.md T-006（Track=qa），本阶段不实现，不生成任何 `tests/e2e/**` 文件。

## AC 覆盖率汇总

- AC 总数：8（requirements.md）+ 1 个任务级细分 AC（AC-005a，来自 T-002）
- unit 验证方式的 AC：AC-001、AC-002、AC-003、AC-004（4 条）—— **4/4 已被单测覆盖**（100%），其中 AC-002 本轮补写 1 例修复遗漏
- 任务级 AC-005a（接口形状，unit/类型层）—— **判定类型层已充分覆盖，不新增运行时单测**（1/1，按类型保证计入已覆盖）
- playwright-mcp 验证方式的 AC：AC-005、AC-006、AC-007、AC-008（4 条）—— **0/4，全部 deferred to qa**（符合角色边界，非缺口）
- AC-007a（`formatUptime` 格式化逻辑子集，AC-007 的 unit 部分）—— **已被单测覆盖**（8 组边界值，超出最小要求）

**汇总**：unit 范畴内应覆盖的 5 条（AC-001~004 + AC-005a）全部覆盖，其中 1 条（AC-002）在本轮查漏中补齐；playwright-mcp 范畴的 4 条按设计正确 defer 到 qa 阶段，不计入本阶段缺口。

## 按场景维度覆盖

| 场景维度 | 涉及 AC | unit 覆盖 |
|---|---|---|
| happy-path | AC-001, AC-005a | ✅ AC-001 单测覆盖；AC-005a 类型层覆盖 |
| error | AC-002 | ✅ 单测覆盖（含本轮补充的响应体防泄露断言） |
| boundary | AC-003, AC-007a | ✅ 均单测覆盖 |
| security | AC-004 | ✅ 单测覆盖（无鉴权可访问 + 字段白名单） |
| ui-state | AC-008 | ⏸ deferred to qa（非 unit 验证方式） |
