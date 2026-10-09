# 任务分解文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-26/001-wallet-login-multi-chain-feature/
- **生成时间**: 2026-09-26 11:30:00
- **基于设计**: design.md

## Track 路径说明（existing project 覆盖默认值）

本项目测试文件与源码同目录共存（`*.test.ts` 紧挨被测文件），不是 `tests/unit/web/` 镜像目录（`.claude/EXISTING_STRUCTURE.md` 第 76 条，design.md「遵循的项目规范」已引用）。因此：
- `frontend` Track 的测试文件路径为 `apps/web/src/**/*.test.ts`（不是 `tests/unit/web/`）
- `unit-test` Track（仅 Phase 3）同样落在 `apps/web/src/**/*.test.ts`，只是标记为独立查漏任务
- `qa` Track 固定落在 `tests/e2e/`（E2E 规范不受此项目的单测惯例影响，见 `.claude/rules/workflow-rules.md` Artifact Gate）

## 任务总览

| Phase | 任务数 | 总工时 |
|-------|--------|--------|
| Phase 1: 基础设施 | 2 | 3h |
| Phase 2: 核心功能 | 3 | 8h |
| Phase 3: 完善 | 2 | 6h |
| **合计** | **7** | **17h** |

## 任务 Track 汇总（按角色视图）

| Track      | 任务数 | 总工时 | 任务 ID                          |
|------------|--------|--------|-----------------------------------|
| frontend   | 4      | 10h    | T-002, T-003, T-004, T-005        |
| backend    | 0      | 0h     | —                                  |
| shared     | 0      | 0h     | —                                  |
| infra      | 1      | 1h     | T-001                              |
| unit-test  | 1      | 3h     | T-006                              |
| qa         | 1      | 3h     | T-007                              |
| **合计**   | **7**  | **17h**|                                    |

## Phase 1: 基础设施

### [x] T-001: 安装钱包相关依赖

**描述**: 按 design.md 5.3 安装 `@reown/appkit`、`@reown/appkit-adapter-wagmi`、`@reown/appkit-adapter-solana`、`wagmi`、`viem`、`@solana/web3.js` 到 `apps/web`，确认无 peer dependency 冲突、`pnpm run check-types` 通过。

**实现偏差**：实现期间又补装了 `bs58`、`@reown/appkit-controllers`、`@reown/appkit-utils`（类型引用需要，`node-linker=isolated` 不允许幽灵依赖），并在 `pnpm-workspace.yaml` 加了 `viem` 版本 override（解决 wagmi/appkit 生态多份 viem 物理副本导致的 tsc 深层泛型报错）。全部记录在 `tracks/foundation.md`，design.md 5.3 已同步。

**目标文件**:
- apps/web/package.json
- pnpm-workspace.yaml（补充：`allowBuilds` 审批 + `viem` override，超出原计划）

**Track**: infra

**适用规范**: 无（纯依赖安装，不涉及项目专属 skill）

**Requirement IDs**:
- R-001
- R-002
- R-005

**验收标准**:
- [x] Given design.md 5.3 列出的 6 个包及版本约束，When 执行 `pnpm install`，Then `apps/web/package.json` 新增这 6 个依赖且版本落在约束范围内，`pnpm-lock.yaml` 同步更新，无 peer dependency 警告级以上错误
- [x] Given 依赖已安装，When 执行 `pnpm run check-types`，Then `apps/web` 类型检查通过（新依赖不引入类型冲突）

**依赖关系**: 无

**复杂度**: S

**预估工时**: 1h

---

### [x] T-002: AppKit 懒加载配置模块

**描述**: 在 `apps/web/src/lib/wallet/` 下建 AppKit 初始化配置：用 `next/dynamic(..., {ssr:false})` 包一层懒加载入口，只在被实际 import 时才触发 `@reown/appkit` 相关模块的下载与 `createAppKit()` 初始化；配置两个 adapter（wagmi、solana）、`projectId` 取自 `env.NEXT_PUBLIC_REOWN_PROJECT_ID`。不在应用根 `Providers` 里挂载任何 AppKit Provider。

**实现偏差**：文件名从 `appkit.ts` 改为 `appkit-config.ts`（更准确描述其职责：只是配置装配，不含懒加载入口本身——懒加载入口实际落在 `wallet-login.tsx` 的 `next/dynamic`，见 T-003）；`appkit.test.ts` → `appkit-config.test.ts`。核实已安装的 `@reown/appkit@1.8.24` 源码后发现 `AppKitProvider` 组件本身就是懒加载友好的（模块级单例，见 design.md 决策记录的 ASM-D02 解决过程），所以没有额外再包一层 `next/dynamic` 在这个文件里——`next/dynamic` 包的是消费这个配置的组件（`wallet-connect-panel.tsx`），在 `wallet-login.tsx` 里。

**目标文件**:
- apps/web/src/lib/wallet/appkit-config.ts
- apps/web/src/lib/wallet/appkit-config.test.ts

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-005

**验收标准**:
- [x] **AC-008** (ui-state/性能): Given 用户首次访问 `/` 且未打开登录弹窗，When 加载首页，Then 浏览器网络请求列表（Playwright `list_network_requests`）不包含 `@reown/appkit` 或其 adapter 的 JS chunk（**代码结构已满足**：`appkit-config.ts` 只有类型/构造逻辑，实际懒加载入口在 `wallet-login.tsx` 的 `next/dynamic`；浏览器层面的网络请求断言本身仍等 T-007 qa 命令执行确认，非本任务能单测覆盖）
- [x] Given `appkit-config.ts` 导出的 `getWalletAppKitConfig()`，When 单元测试直接调用该函数，Then 返回的配置对象包含两个 adapter 实例且 `projectId` 等于 `ENV.NEXT_PUBLIC_REOWN_PROJECT_ID`（`appkit-config.test.ts` 4 条用例全绿，mock 了 adapter 构造函数避免真的初始化钱包发现逻辑）

**依赖关系**:
- 前置任务: T-001

**复杂度**: M

**预估工时**: 2h

---

## Phase 2: 核心功能

### [x] T-003: EVM 钱包连接登录主链路

**描述**: 把 `wallet-login.tsx` 从样式桩改为真实流程：点击按钮 → 触发 T-002 的懒加载入口 → 打开 AppKit 弹窗 → 用户选择 EVM 钱包完成连接 → 拿到 `address` → 调 `requestNonce({address, chain:"evm"})` → 用钱包对 `NonceResult.message` 签名（原样传递，不做任何字符串处理）→ 调 `verifySignature` → 成功后调 `useAuthStore.login(token)`、按 `isNew` 显示开户提示、关闭登录弹窗。同时确保退出登录逻辑不触发 AppKit 断开连接（不新增任何 disconnect 调用）。

**实现偏差**：新增了 `apps/web/src/lib/wallet/wallet-connect-panel.tsx`（原计划外文件）——这是实际挂 `AppKitProvider` + 调用 AppKit hooks（`useAppKit`/`useAppKitAccount`/`useAppKitProvider`/`useAppKitState`）的组件，`wallet-login.tsx` 改造成只做 `next/dynamic` 懒加载入口，两者职责分开是为了让"首屏不打包 AppKit"这条边界更干净（懒加载边界=文件边界）。另外新增 `apps/web/src/stores/auth-store.test.ts`（原计划外文件，之前这个 store 没有测试），专门给 AC-007 补一条 logout 行为断言。

**目标文件**:
- apps/web/src/app/_shared/ui-components/login-dialog/wallet-login.tsx
- apps/web/src/lib/wallet/wallet-connect-panel.tsx（新增，见上）
- apps/web/src/lib/wallet/sign-in.ts
- apps/web/src/lib/wallet/sign-in.test.ts
- apps/web/src/stores/auth-store.test.ts（新增，见上）

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-001
- R-004

**验收标准**:
- [ ] **AC-001** (happy-path，验证方式 playwright-mcp+unit): 逻辑链路（nonce→签名→verify→login→isNew 提示→关弹窗）已实现且被 `sign-in.test.ts` 的"happy-path"用例覆盖；**浏览器层面的真实点击/顶栏渲染确认留给 T-007 qa 命令**，此处暂不勾选，待 qa 通过后回填
- [x] **AC-010** (security，验证方式 unit): `sign-in.test.ts` 断言传给签名函数的字符串与 `NonceResult.message` 全等，全绿
- [x] **AC-007** (boundary): `auth-store.test.ts` 断言 `logout()` 只调用 `setToken(null)`；`wallet-connect-panel.tsx`/`auth-store.ts` 通篇未 import 任何 `@reown/*` 的 disconnect 相关符号（代码审查确认）
- [x] **AC-006** (boundary，验证方式 manual): 未对"未安装钱包"做任何自定义判断分支，完全交给 AppKit 弹窗原生处理（代码审查确认，自动化范围内已满足；真实钱包插件下的人工验收留给用户，见 requirements.md 该 AC 的验证方式）

**依赖关系**:
- 前置任务: T-002

**复杂度**: L

**预估工时**: 4h

---

### [x] T-004: Solana 钱包连接登录主链路

**描述**: 在 T-003 建好的 `sign-in.ts` 编排逻辑基础上，加 Solana 分支：AppKit 弹窗选择 Solana 钱包完成连接 → 拿到 Solana 地址 → `requestNonce({address, chain:"solana"})` → 用 Solana 钱包对 message 签名（SIWS）→ `verifySignature` → 复用 T-003 的登录收尾逻辑。

**目标文件**:
- apps/web/src/lib/wallet/sign-in.ts
- apps/web/src/lib/wallet/sign-in.test.ts

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-002
- R-004

**验收标准**:
- [ ] **AC-002** (happy-path，验证方式 playwright-mcp+unit): 逻辑链路已实现（`solanaSignMessage` 把签名字节编码成 base58 交给 `signInWithWallet`）并被 `sign-in.test.ts` 覆盖；**浏览器层面确认留给 T-007 qa 命令**，暂不勾选
- [x] **AC-010** (security): `sign-in.test.ts` 已有独立断言覆盖 Solana 分支（`solanaSignMessage` 用例：传入 `provider.signMessage` 的字节解码回来等于原始 message）
- [x] **AC-011** (security): 新增单测——先后各登录一次 EVM/Solana，断言 `requestNonce`/`verifySignature` 两次调用参数各自独立、返回的两个 `LoginResult.account.id` 不同，代码里也没有任何跨调用共享状态

**依赖关系**:
- 前置任务: T-003

**复杂度**: M

**预估工时**: 2h

---

### [x] T-005: 错误处理与加载态 UI

**描述**: 补齐 `wallet-login.tsx` 在连接/签名/校验各阶段的失败与中间状态展示：用户拒绝签名、nonce 过期、签名校验失败（服务端返回的中文 message 原样展示，模式同 `email-login.tsx` 的 `role="alert"` 错误块）；连接中/等待签名/登录中三个中间态按钮禁用并显示对应文案，防止重复点击触发多次 nonce 申请。

**实现偏差**：错误处理和加载态其实是和 T-003 的主链路一起在 `wallet-connect-panel.tsx` / `sign-in.ts` 里写完的（拆开写反而要来回改同一段状态机代码），没有单独的 `wallet-login.test.ts`——`wallet-login.tsx` 现在只是个 `next/dynamic` 懒加载壳，没有值得单测的逻辑；这两块状态机（拒签/过期/校验失败的分支、连接中/签名中/登录中的阶段切换）的可单测部分已经在 `sign-in.ts`／`sign-in.test.ts` 里覆盖，UI 渲染层面维持和 `email-login.tsx` 一致的模式（`role="alert"`），这条模式本身没有测试先例（`email-login.tsx` 也没有组件测试），留给 T-007 qa 做真实渲染确认。

**目标文件**:
- apps/web/src/lib/wallet/wallet-connect-panel.tsx（实际写状态机/UI 的地方，替代原计划的 wallet-login.tsx）
- apps/web/src/lib/wallet/sign-in.ts
- apps/web/src/lib/wallet/sign-in.test.ts（替代原计划的 wallet-login.test.ts）

**Track**: frontend

**适用规范**: 无

**Requirement IDs**:
- R-003

**验收标准**:
- [ ] **AC-003** (error，验证方式 playwright-mcp): 逻辑已实现（`isUserRejection` 识别拒签 → 展示"已取消签名"文案 + 保留连接状态 + 可点"重新签名"）并被 `sign-in.test.ts` 覆盖到"拒签后不发起 verify"这一段；**页面渲染层面确认留给 T-007 qa 命令**
- [ ] **AC-004** (error，验证方式 unit+playwright-mcp): `sign-in.test.ts` 已覆盖"verify 失败时错误原样抛出、不吞掉"；**服务端中文 message 在页面上原样展示这一步是 UI 渲染，留给 T-007 qa 命令**确认后再勾选
- [ ] **AC-005** (error，验证方式 unit+playwright-mcp): 同 AC-004，逻辑层已覆盖，UI 渲染层面留给 qa
- [ ] **AC-009** (ui-state，验证方式 playwright-mcp): `sign-in.test.ts` 已覆盖 `onStage` 按 signing→verifying 顺序触发（驱动按钮文案的底层信号）；"按钮实际禁用、连续点击只发一次请求"这类真实交互留给 T-007 qa 命令

**依赖关系**:
- 前置任务: T-004

**复杂度**: M

**预估工时**: 2h

---

## Phase 3: 完善

### [x] T-006: 单元测试查漏

**描述**: 对照 requirements.md 的 AC-001～AC-011 逐条核对 T-002～T-005 自带单测的覆盖率，补齐遗漏的边界/安全分支（尤其是 AC-010 在 EVM/Solana 两个分支下是否都有独立断言、AC-011 的"不合并身份"断言、AC-007 的 disconnect 未被调用断言）。不重复已在 Phase 2 任务中写过的用例。

**查漏结果**：逐条核对后发现 AC-011（不合并身份）和 AC-007（logout 不断连）在 Phase 2 任务里只有代码层面的"没写错误逻辑"保证，缺一条直接的断言——已补：
- `sign-in.test.ts` 新增"AC-011"用例（两次不同链登录互不干扰）
- `auth-store.test.ts`（新增文件，见 T-003 偏差说明）补 AC-007 的 `logout()` 行为断言

其余 AC（001/002/003/004/005/009 的 unit 可测部分、006/010）在 Phase 2 任务实现时已随手写好，没有遗漏。AC-001/002/003/004/005/009 里依赖 playwright-mcp 的部分不在本任务范围（qa 命令负责，T-007 已相应补场景）。

**目标文件**:
- apps/web/src/lib/wallet/sign-in.test.ts
- apps/web/src/stores/auth-store.test.ts

**Track**: unit-test

**适用规范**: 无

**Requirement IDs**:
- R-001
- R-002
- R-003
- R-004

**验收标准**:
- [x] Given T-002～T-005 已实现，When 执行 `pnpm --filter web test`，Then 全部通过（225/225），且 AC-001～AC-011 均能在测试文件中找到对应的断言（`sign-in.test.ts`/`auth-store.test.ts` 涉及正式 AC 的用例标题都标了 AC-ID 方便追溯；`appkit-config.test.ts` 验证的是懒加载配置装配本身，不直接对应某条 AC，是 T-002/AC-008 的支撑性测试；纯 playwright-mcp 分支的断言不在 unit 层，已在各任务的验收标准里注明留给 qa）
- [x] **AC-010** (security，跨分支补测): `sign-in.test.ts` 的 evmSignMessage/solanaSignMessage 各自独立断言"传给签名函数的字符串 === nonce 响应的 message"

**依赖关系**:
- 前置任务: T-005

**复杂度**: M

**预估工时**: 3h

---

### [ ] T-007: 浏览器验收规格（钱包登录）

**描述**: 只写 Given-When-Then 形式的浏览器验收场景规格与选择器约束，不写实现代码；由 `qa` 命令据此生成 Playwright 脚本并执行。场景覆盖 AC-001、AC-002、AC-003、AC-004、AC-005、AC-007、AC-008、AC-009（AC-004/005/007 是 apply 阶段自查发现的补充：requirements.md 里这三条的验证方式含 playwright-mcp，原 T-007 只列了 5 条场景，遗漏了这三条，此处补全，避免只有 unit 覆盖就当作完整验收）。

**目标文件**:
- tests/e2e/wallet-login-multi-chain/（由 `qa` 命令生成 `E2E-*.e2e.ts`，本任务只交付规格，不落地代码）

**Track**: qa

**适用规范**: 无

**Requirement IDs**:
- R-001
- R-002
- R-003
- R-004
- R-005

**验收标准（浏览器验收规格，非实现）**:
- [ ] **AC-001**: Given 注入 mock EIP-1193 provider 并访问首页，When 打开登录弹窗 → 切到"钱包登录" tab（选择器：`[data-testid="login-tab-wallet"]` 或等效的 tab trigger 文本"钱包登录"）→ 点击连接按钮 → 完成 mock 签名，Then 顶栏出现登录态元素（余额/昵称），弹窗关闭
- [ ] **AC-002**: 同上，替换为 mock Solana provider，验证 Solana 分支同样能登录成功
- [ ] **AC-003**: Given 已连接钱包，When mock provider 模拟签名被拒绝，Then 页面显示"已取消签名"类文案（选择器：`[role="alert"]`），弹窗保持打开，钱包连接状态不丢（可点"重新签名"按钮再次触发）
- [ ] **AC-004**: Given mock 后端接口对 `POST /auth/verify` 返回 nonce 过期的错误响应，When 完成签名后提交，Then 页面原样显示服务端中文错误文案（选择器：`[role="alert"]`），且能重新点击发起新的连接/签名
- [ ] **AC-005**: Given mock 后端接口对 `POST /auth/verify` 返回 401 签名不匹配错误，When 完成签名后提交，Then 页面显示服务端错误信息，不出现已登录的顶栏状态
- [ ] **AC-007**: Given 已用钱包登录成功，When 点击"退出登录"，Then 顶栏回到未登录态，且刷新钱包连接状态（AppKit 自身的连接指示，若可观测）未被断开——不要求重新走一遍"连接钱包"的地址选择步骤即可再次登录
- [ ] **AC-008**: Given 未打开登录弹窗直接访问首页，When 用 `list_network_requests` 检查网络请求，Then 请求 URL 中不出现 `@reown` 相关 chunk 路径
- [ ] **AC-009**: Given 点击连接后处于中间状态，When 检查按钮元素，Then 按钮带 `disabled` 属性且文案为"连接中…"/"等待签名…"/"登录中…"之一

**依赖关系**:
- 前置任务: T-005（qa 命令在 apply 完成后单独执行，不在 apply 阶段跑）

**复杂度**: M

**预估工时**: 3h

---

## 依赖关系图

```
T-001 ── T-002 ── T-003 ── T-004 ── T-005 ──┬── T-006
                                            └── T-007
```

## 任务执行顺序

1. T-001（安装依赖）
2. T-002（懒加载配置模块）
3. T-003（EVM 主链路）
4. T-004（Solana 主链路，复用 T-003 的编排逻辑）
5. T-005（错误处理与加载态，覆盖前面两条链路共用的失败分支）
6. T-006 与 T-007 可并行：T-006（单元测试查漏，apply 阶段执行）、T-007（浏览器验收规格，由 qa 命令消费）
