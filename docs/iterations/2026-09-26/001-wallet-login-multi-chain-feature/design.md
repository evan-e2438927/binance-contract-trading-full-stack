# 技术设计文档

## 基本信息

- **迭代目录**: docs/iterations/2026-09-26/001-wallet-login-multi-chain-feature/
- **生成时间**: 2026-09-26 11:10:00
- **基于需求**: requirements.md

## 0. 前置澄清门禁复核

交互模式（proposal）。requirements.md 的「假设标注」记录：本次没有 provenance=never-asked 且有设计影响的低/中置信度项——所有关键决策（技术选型、Project ID 可用性、账户隔离策略）均已有代码/文档出处核实，非猜测假设，故不触发 AskUserQuestion 澄清门禁。唯一需要显式登记的是测试策略假设，见下方「设计假设」。

## 遵循的项目规范

- `.claude/skills/` 目录下仅有 `README.md`（机制说明），未发现实际项目规范 skill 文件，本次无命中的项目专属 skill。
- 遵循根 `CLAUDE.md` 五条硬约束中与本次相关的：第 4 条（bigint 不进 JSON，本次不涉及金额字段，不适用）、依赖方向（`web → shared`，本次新增依赖全部落在 `apps/web`，不违反方向）。
- 遵循 `.claude/EXISTING_STRUCTURE.md` 第 76 条：测试文件与源码同目录共存（`*.test.ts` 紧挨被测文件），不使用镜像 `tests/unit/` 目录——本次新增前端测试沿用此惯例。
- 遵循 `.claude/SECURITY.md:8-10`：三种登录方式互相独立开户、不做账户合并；JWT payload 不含身份细节；本次不改动这套逻辑，只是把前端钱包这一分支接上。

## 0. 目录影响声明

### 0.1 目标目录
- `apps/web/src`: 修改/新增（登录弹窗钱包组件、新增 providers/hooks、新增依赖）
- `apps/server/src`: **不修改**（钱包签名验证、nonce/verify 路由已完成，见 requirements.md「背景核实」）
- `packages/*`: **不修改**（`packages/db` schema、`packages/shared` 枚举均已支持两条链）

### 0.2 新增目录
- `apps/web/src/lib/wallet/`（新增）——存放 AppKit 初始化配置、chain→provider 映射等纯前端逻辑，原因：钱包相关配置逻辑不属于任何现有 `lib/` 子目录（`lib/axios-client`、`lib/session` 等各管一块），需要独立归类，避免堆进 `lib/config/`

### 0.3 偏离说明
- 无偏离。沿用 Better-T-Stack 风格下 `apps/web` 内部惯例（`lib/*` 放跨组件复用逻辑），不新增顶层目录，不新增 `packages/*`。

## 1. 技术方案概要

### 1.1 概述
把 `apps/web` 登录弹窗的"钱包登录" tab 从纯样式桩接成真实链路：引入 Reown AppKit（`@reown/appkit` + `appkit-adapter-wagmi` + `appkit-adapter-solana`），用同一个弹窗同时支持 EVM 与 Solana 钱包的连接与签名，签名结果提交给已经完成的 `POST /auth/nonce` / `POST /auth/verify` 换取 JWT，复用邮箱登录已有的 `useAuthStore.login()` 完成登录态写入。整个 AppKit 相关代码懒加载，不影响首屏。

### 1.2 目标
- 用户能用 EVM 钱包（MetaMask 等）和 Solana 钱包（Phantom 等）完成登录
- 复用后端已完成的签名验证能力，前端零改动后端契约
- 不拖慢首屏加载

### 1.3 非目标（Scope 外）
- 不做多钱包绑定同一账户
- 不裁剪 AppKit 默认钱包列表
- 不改动后端 `auth/` 模块或数据库 schema

## 2. 数据模型设计

无变更。复用现有表：

| 表 | 变更 | 出处 |
|----|------|------|
| `identities` | 无变更，`provider` 已含 `wallet_evm`/`wallet_solana` | `packages/db/src/schema/identities.ts` |
| `auth_nonces` | 无变更，`chain` 枚举已含 `evm`/`solana` | `packages/db/src/schema/auth-nonces.ts` |

## 3. 接口契约

- **契约形态**: table（沿用项目既有惯例：后端 handler + 前端镜像类型文件，无共享 `packages/contracts`，理由见 `.claude/EXISTING_STRUCTURE.md` 第 58 条——现有 `apps/web/src/server-api-module/*/types.ts` 一贯是手写镜像类型，本次不新建共享包）
- **契约文件**: 无新增/修改。复用 `apps/web/src/server-api-module/auth/types.ts`（`NonceBody`/`NonceResult`/`VerifyBody`/`LoginResult`）与 `apps/server/src/auth/routes.ts`（`POST /auth/nonce`、`POST /auth/verify`）

### 3.1 接口表（本次不新增/修改，列出用于确认前端如何调用）

| 方法 | 路径 | 请求体 | 成功响应 | 错误响应 | 认证 | 关联 AC |
|------|------|--------|----------|----------|------|---------|
| POST | /auth/nonce | `{address, chain}` | 200 `{nonce, message, expiresAt}` | 400 参数错误 | 否 | AC-001, AC-002, AC-004 |
| POST | /auth/verify | `{address, chain, nonce, signature}` | 200 `{token, account:{id, isNew}}` | 401（nonce 过期/签名不匹配等，具体错误码见 `apps/server/src/auth/routes.ts`） | 否 | AC-001, AC-002, AC-004, AC-005 |

> 前端严格按 `types.ts` 已声明的字段调用，不新增字段、不改响应结构；实现中若发现契约需要调整，必须先回写本表再改代码（本次预期不会发生）。

## 4. 安全考量

### 4.1 签名原文完整性
`POST /auth/nonce` 返回的 `message` 必须原样交给钱包签名，前端不得拼接/修改（见 requirements.md AC-010）。实现上：签名调用函数的入参直接取自 `NonceResult.message`，不做字符串处理。

### 4.2 会话与身份隔离
沿用现状：JWT payload 只含 `{sub: accountId, iat, exp}`（`.claude/SECURITY.md:9`）；`(provider, providerId)` 唯一索引保证不同链地址不会被误判为同一账户（AC-011）。前端不引入任何"合并账户"的客户端逻辑。

### 4.3 敏感操作边界
新增的 AppKit 相关代码全部运行在 `apps/web`（浏览器端），不持有任何私钥/服务端密钥，符合 `.claude/SECURITY.md:52`（`apps/web` 不得持有敏感密钥）——钱包私钥始终留在用户的钱包扩展/硬件里，前端只拿到签名结果。

### 4.4 依赖供应链
`@reown/appkit` 系列包体积较大且涉及连接第三方钱包，需锁定精确版本（见 5.3），并确认懒加载不会把该依赖打进首屏 bundle（AC-008 用网络请求断言验证）。

## 5. 依赖关系

### 5.1 内部依赖
- 新增的 `apps/web/src/lib/wallet/` → 被 `wallet-login.tsx` 使用
- `wallet-login.tsx` → 复用现有 `apps/web/src/server-api-module/auth/mutations.ts`（`requestNonce`/`verifySignature`）
- 登录成功后 → 复用现有 `useAuthStore.login(token)`（与 `email-login.tsx` 完全一致的收尾逻辑）

### 5.2 外部依赖
- Reown Cloud（`cloud.reown.com`）签发的 Project ID：已在本地 `.env` 配置，生产环境部署前需确认该 Project ID 在目标域名下已授权（Reown 项目设置里的 allowed domains），此项落在 `apply`/部署阶段确认，不阻塞本次开发

### 5.3 新增依赖

| 包名 | 版本约束 | 用途 | 归属 Track |
|------|----------|------|------------|
| @reown/appkit | ^1.8.24 | 统一钱包连接弹窗核心库 | frontend |
| @reown/appkit-adapter-wagmi | ^1.8.24 | EVM 链适配器 | frontend |
| @reown/appkit-adapter-solana | ^1.8.24 | Solana 链适配器 | frontend |
| wagmi | ^3.7.7 | EVM 钱包连接状态管理（AppKit wagmi adapter 的 peer dep） | frontend |
| viem | ^2.56.9 | EVM 签名/地址处理（wagmi peer dep；与 `apps/server` 已用的 `viem` 版本线一致） | frontend |
| @solana/web3.js | ^1.99.0 | Solana 连接/交易基础库（AppKit solana adapter 的 peer dep） | frontend |
| bs58 | ^6.0.0 | Solana 签名结果编码成 base58 字符串再提交给 `POST /auth/verify`（与 `apps/server` 现有版本线一致） | frontend |
| @reown/appkit-controllers | ^1.8.24 | `Provider`（EVM `request()`）等类型声明的直接来源 | frontend |
| @reown/appkit-utils | ^1.8.24 | Solana `Provider`（`signMessage()`）类型声明的直接来源（`@reown/appkit-utils/solana`） | frontend |

> 均安装在 `apps/web`。`bs58`、`@reown/appkit-controllers`、`@reown/appkit-utils` 三项是实现阶段核对
> `apps/server/src/auth/wallet.ts` 的验签格式、以及 `tsc` 报 `Cannot find module` 后确认需要补充的直接依赖——
> `node-linker=isolated` 下不允许依赖 `@reown/appkit` 内部的同名传递依赖，哪怕只是类型引用也不行；
> 补装记录见 `tracks/foundation.md`。以上依赖由 apply ⑥.1 主 agent 统一安装，开发角色不直接改 `package.json`/lockfile。

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| AppKit 首次加载体积较大，懒加载实现不当导致首屏变慢 | 中 | 中 | 用 `next/dynamic(..., {ssr:false})` 只在"钱包登录" tab 挂载时才 import；AC-008 用网络请求断言验证首屏不含 appkit chunk |
| 无头浏览器环境无法安装真实 MetaMask/Phantom 扩展，自动化验收覆盖不全 | 高 | 中 | 用 mock EIP-1193 / mock Solana wallet-standard provider 注入的方式覆盖连接与签名主链路（见「设计假设」）；真实扩展下的人工点击验收留给用户本人，`HANDOFF.md` 已如此约定 |
| Reown Project ID 在生产域名下未授权，导致线上环境弹窗报错 | 低 | 中 | 部署前在 Reown Cloud 后台确认 allowed domains 包含生产域名（属于部署检查项，不属于本次代码改动范围） |
| `@reown/appkit` 版本迭代快，API 细节可能与设计假设的用法有出入 | 中 | 低 | 实现阶段以当前安装版本的官方文档为准微调具体 hook/方法名，不影响整体架构（见「设计假设」） |

## 7. 实施计划

### Phase 1: 基础设施
- [ ] 安装依赖（5.3）
- [ ] `apps/web/src/lib/wallet/` 下建 AppKit 初始化配置（懒加载模块）

### Phase 2: 核心功能
- [ ] `wallet-login.tsx` 接入真实连接/签名/verify 流程（EVM）
- [ ] 同一流程接入 Solana 分支
- [ ] 错误处理与加载态 UI

### Phase 3: 完善
- [ ] 单元测试（签名原文透传、错误分支、mock provider 主链路）
- [ ] 浏览器验收（qa 命令负责，见 tasks.md 的 qa Track 任务）

## 8. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-09-19（既有决策，本次沿用） | 用 Reown AppKit 而非 RainbowKit + solana wallet-adapter 两套弹窗 | 避免两套 Provider、两套弹窗体验割裂（`docs/design/05-frontend-design.md:489`） |
| 2026-09-26（本次新定） | AppKit 相关 Provider 只包裹 `WalletLogin` 组件子树，不包裹整个 `apps/web` 应用 | 应用其余部分不需要 wagmi/solana 的 React hooks；缩小 Provider 范围也让懒加载更彻底（卸载 tab 后不残留额外渲染开销） |
| 2026-09-26（proposal 阶段假设，apply 阶段核实后撤销） | ~~AppKit 复用应用已有的 `QueryClient` 实例~~ | 核实 `@reown/appkit@1.8.24` 实际依赖后发现它内部用 `valtio` 做状态管理，**不依赖 `@tanstack/react-query`**，没有这个需求；`AppKitProvider` 不需要额外的 QueryClientProvider 包裹，直接印证了 ASM-D02 里"具体接入方式以实现时的已安装版本为准"的做法 |

## 设计假设

以下决策由本次设计做出、requirements.md 未逐字给出，登记于此，标明理由与假设错误时的影响：

### ASM-D01: 无头浏览器验收使用 mock 钱包 provider，而非真实扩展
- **关联需求**: AC-001, AC-002, AC-003, AC-005, AC-006
- **假设内容**: Playwright MCP 浏览器验收通过 `page.addInitScript`/`evaluate` 注入符合 EIP-1193（EVM，`window.ethereum`）和 Solana Wallet Standard 的 mock provider 对象来模拟"已安装钱包"，而不是在 CI/沙箱环境安装真实 MetaMask/Phantom 浏览器扩展
- **理由**: 无头 Playwright 环境本身不支持安装浏览器扩展（或支持成本极高、不稳定），这是 web3 前端测试的行业通行做法；`HANDOFF.md` 也明确把"真实钱包扩展下的登录验收"列为需要用户本人完成的事项（遗留事项第 2 条），与本假设一致
- **若假设错误的影响**: 如果 AppKit 弹窗内部逻辑强依赖某些真实扩展才有的浏览器 API（而非标准 EIP-1193/wallet-standard 接口），mock provider 可能无法完全触发 AppKit 的检测逻辑，导致 AC-001/AC-002 的自动化验收需要降级为部分 mock（直接调用 AppKit 暴露的 connect/sign 方法而非模拟"检测到扩展"这一步）；不影响生产代码逻辑本身，只影响验收方式

### ASM-D02: AppKit 具体 hook/方法名以实现时的已安装版本为准
- **关联需求**: R-001, R-002
- **假设内容**: design.md 不锁定 `@reown/appkit` 的具体 hook 名称（如 `useAppKitAccount`/`useAppKitProvider` 等），只约定"用 AppKit 提供的 React 通用 hooks 获取连接账户与请求签名"这一架构层决策；具体调用方式在 apply 阶段对照当前安装版本（^1.8.24）的官方文档确定
- **理由**: 第三方库 API 随版本变化，proposal 阶段不应把可能过时的具体方法名写死进设计文档（`CLAUDE.md`"宁可说做不到，不要编数字"同样适用于"不要编不确定的第三方 API"）
- **若假设错误的影响**: 无功能性影响，只影响 apply 阶段实现任务的具体代码写法，不改变任务边界和验收标准
