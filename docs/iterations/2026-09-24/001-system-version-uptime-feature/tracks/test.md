# Track 汇报：test

- 状态: done
- 执行者: sdlc-test-dev
- 完成时间: 2026-09-24T12:02:15Z

## 完成的任务与 AC
- T-004（后端 system 接口单元测试）：
  - AC-001 ✅ 开发角色（backend）已覆盖，逐条核实断言无误（固定时钟精确比对 `{ok:true, data:{version:"0.1.0", uptime:30}}`）
  - AC-002 ⚠️→✅ 开发角色原测试只断言 `status===404`，遗漏「不返回 `{version, uptime}` 之外的信息」这半句 AC 描述；**我新增** 1 个用例断言 404 响应体不含 `version`/`uptime`/`"ok":true`
  - AC-003 ✅ 开发角色已覆盖（非负整数三维度）
  - AC-004 ✅ 开发角色已覆盖（无鉴权可访问 + `data` 字段白名单）
- T-005（前端 uptime 格式化函数单元测试）：
  - AC-007a ✅ 开发角色（frontend）已覆盖，8 组边界值（0/59/60/3599/3600/86399/86400/90000），超出任务最小要求，未发现遗漏，未新增
- AC-005a（T-002 任务级细分 AC，`fetchSystemVersion()` 接口形状）：判定为**不需要**补运行时单测，理由见下方「与设计的偏差」
- AC-005 / AC-006 / AC-007（渲染层）/ AC-008：验证方式均为 playwright-mcp，本阶段不写任何测试，已在 `tests/reports/system-version-uptime-coverage.md` 登记为 `deferred to qa`

## 修改的文件
- `apps/server/src/api/system.test.ts`（只新增 1 个 `it()` 用例，未修改/删除任何已有断言）
- `tests/reports/system-version-uptime-coverage.md`（新建）
- `docs/iterations/2026-09-24/001-system-version-uptime-feature/tracks/test.md`（本文件）

## 新增的测试
- `apps/server/src/api/system.test.ts`：新增 `it("AC-002 (error, 补充): 404 响应体不泄露 version/uptime 等业务字段", ...)`，覆盖 AC-002 中此前遗漏的「不泄露业务字段」半句

## 公共文件修改请求
- 无

## 与设计的偏差
- AC-002 原有单测（backend 角色所写）只验证了 `status===404`，未验证 AC-002 描述的后半句「不返回 `{version, uptime}` 之外的信息」。已按角色规则以「只新增用例」方式补齐，不修改原断言，非阻塞。
- `apps/server/src/api/system.test.ts` 存在 3 处 `noExplicitAny`（`body = (await res.json()) as any`）与 1 处 import 排序（biome `organizeImports`）的 lint 警告/错误，均是开发角色（backend）原有代码，不在我「只新增测试、不改断言」的权限范围内修复，也不属于我新增的那行代码。已运行 `pnpm --filter server exec biome check` 只读核查确认，未执行 `--fix`。建议主 agent 转给 backend 角色在下一轮处理。`apps/web` 侧 `version-info.test.ts` 无 lint 问题。
- AC-005a（`fetchSystemVersion()` 返回值类型与契约一致）判定为**不需要**补运行时单测：该函数是 `request.get<System>("/system/version")` 一行透传，类型已由 `System` 接口在编译期保证且与 design.md §3 接口表逐字对应；`find apps/web/src/server-api-module -name "*.test.ts"` 结果为空，本仓库其他 query 模块（如 `leaderboard/queries.ts` 的 `fetchLeaderboard`）均无此类单测先例，补测会打破项目现有测试密度惯例、边际价值有限。已在覆盖率报告中记录判断依据，供主 agent 复核。

## 阻塞说明（仅 blocked）
不适用（状态为 done）
