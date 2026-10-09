# 任务分解文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-25/002-order-panel-buttons-above-tabs-refactor/
- **生成时间**: 2026-09-25 21:50:00
- **基于设计**: design.md

## 任务总览

| Phase | 任务数 | 总工时 |
|-------|--------|--------|
| Phase 1: 布局调整 | 1 | 0.5h |
| Phase 3: 完善 | 1 | 0.5h |
| **合计** | **2** | **1h** |

## 任务 Track 汇总（按角色视图）

| Track      | 任务数 | 总工时 | 任务 ID |
|------------|--------|--------|---------|
| frontend   | 1      | 0.5h   | T-001   |
| backend    | 0      | 0h     | —       |
| shared     | 0      | 0h     | —       |
| infra      | 0      | 0h     | —       |
| unit-test  | 0      | 0h     | —       |
| qa         | 1      | 0.5h   | T-002   |
| **合计**   | **2**  | **1h** |         |

## Phase 1: 布局调整

### [x] T-001: 互换下单面板 tab 行与按钮行的顺序

**描述**: 在 `OrderPanel` 组件中，把「杠杆 / 保证金模式 / 持仓模式」按钮行（`<ConfigButton>` × 3 组成的 `<div className="flex shrink-0 gap-2 pt-3.5">`）移到「订单类型」tab 行（`<div className="flex h-[34px] shrink-0 border-b">`，渲染 `TABS.map`）**上方**。互换后，按钮行不再带 `pt-3.5`（作为首个子元素，靠面板容器 `p-3.5` 提供顶部间距即可）；tab 行改为带 `pt-3.5`，接管原本按钮行的顶部间距职责，使两行之间的视觉间距与调整前保持一致。除顺序和这两处 `className` 上边距归属外，不改动任何 JSX 内容、`key`、事件处理器、数据绑定逻辑。双向持仓（`positionMode === "HEDGE"`）下的开仓/平仓行保持原位（跟随在新的 tab 行之后，不随按钮行一起上移）。

**目标文件**:
- apps/web/src/app/trade/_ui-components/order-panel/order-panel.tsx（第 165~208 行区域：互换「订单类型」`<div>` 与「杠杆·保证金模式·持仓模式」`<div>` 两个兄弟节点的顺序，并互换两者的 `pt-3.5` class）

**Track**: frontend

**适用规范**: 无（`.claude/skills/` 下无命中的项目自定义 skill）

**Requirement IDs**:
- R-001

**验收标准**:
- [x] **AC-001** (happy-path): Given 打开 `/trade/<symbol>`，When 面板渲染完成，Then 「调整杠杆 / 保证金模式 / 持仓模式」按钮行出现在「限价 / 市价 / 条件委托」tab 行**上方**，两行间保留可见间距
- [x] **AC-002** (error): Given `config` 未返回或用户未登录（`leverageNum` 为 `null` / `loggedIn === false`），When 新顺序下渲染，Then 杠杆按钮仍显示 `PLACEHOLDER` 占位符，三个按钮仍为 `disabled` 态，点击不触发弹窗（沿用现有 `disabled={!loggedIn}` 逻辑，本任务不改动该逻辑）
- [x] **AC-003** (boundary): Given `positionMode === "HEDGE"`，When 面板渲染，Then 开仓/平仓切换行仍渲染在新 tab 行**下方**、价格数量输入区**上方**（最终顺序：按钮行 → tab 行 → 开仓/平仓行 → 其余表单），不出现在按钮行与 tab 行之间
- [x] **AC-004** (ui-state): Given 已登录用户，When 依次点击「调整杠杆」「保证金模式」「持仓模式」三个按钮，Then 分别正确打开 `LeverageDialog` / `MarginModeDialog` / `PositionModeDialog`，与调整前行为一致

> T-001 四项 AC 均以代码检查方式确认（未改动任何点击逻辑/状态绑定，仅移动两个 JSX 区块顺序 + 调整上边距 class）；实际浏览器渲染/交互验证由 T-002（qa）执行。

**依赖关系**: 无

**复杂度**: S

**预估工时**: 0.5h

---

## Phase 3: 完善

### [ ] T-002: 浏览器验收 — 下单面板按钮行位置

**描述**: 用 Playwright MCP 在真实浏览器中核对 T-001 的改动：按钮行是否稳定显示在 tab 行上方，各交互态（未登录禁用态、双向持仓开仓/平仓行、三个弹窗）是否与调整前一致，间距观感是否正常（不贴边、不跳跃）。

**目标文件**:
- tests/e2e/order-panel-buttons-above-tabs/E2E-001.e2e.ts（qa 命令生成）
- tests/reports/order-panel-buttons-above-tabs-e2e-report.md（qa 命令生成）

**Track**: qa

**适用规范**: 无

**Requirement IDs**:
- R-001

**验收标准**:
- [ ] **AC-001** (happy-path): Given 打开交易页，When 截图下单面板顶部区域，Then 按钮行（20x/全仓或逐仓/单向持仓或双向持仓）在 tab 行（限价/市价/条件委托）上方，选择器 `order-panel` 内按钮行的 DOM 顺序早于 tab 行
- [ ] **AC-002** (error): Given 未登录状态打开交易页，When 观察三个按钮，Then 呈现禁用态样式（`disabled` 属性存在），点击无弹窗打开
- [ ] **AC-003** (boundary): Given 测试账号持仓模式为双向持仓（或通过「持仓模式」按钮切换为双向持仓），When 观察面板，Then 「开仓/平仓」行出现在 tab 行下方
- [ ] **AC-004** (ui-state): Given 已登录测试账号，When 点击「调整杠杆」「保证金模式」「持仓模式」，Then 依次弹出对应弹窗且可正常关闭

**依赖关系**: T-001

**复杂度**: S

**预估工时**: 0.5h

---

## 依赖关系图

```
T-001 ── T-002
```

## 任务执行顺序

1. T-001（apply 阶段实现）
2. T-002（qa 阶段浏览器验收）
