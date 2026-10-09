# 需求文档

## 基本信息

- **采集时间**: 2026-09-26 10:50:00
- **迭代序号**: 001
- **输入类型**: text
- **变更类型**: feature
- **Slug**: wallet-login-multi-chain
- **业务优先级**: P1(高)
- **技术风险**: 中

## 原始需求

> 我发现钱包链接登录好像还没有完成，我需要支持到多个钱包登录，ETH 和 Solana

## 需求摘要

打通前端「钱包登录」入口的真实连接与签名验证流程，让 EVM（以太坊等）和 Solana 链的钱包都能完成登录，而不再只是提示"即将开放"的样式桩。

## 背景核实（非猜测，均有代码/文档出处）

在写需求前先核实了当前真实状态，结论和用户的直觉一致，但比"整体没做"更精确——**后端与数据层早已完成，缺口只在前端这一层**：

| 层 | 状态 | 出处 |
|----|------|------|
| 后端钱包签名验证（EVM SIWE + Solana SIWS） | ✅ 已完成，两条链都有测试覆盖 | `apps/server/src/auth/wallet.ts`、`apps/server/src/auth/wallet.test.ts`、`apps/server/src/auth/routes.ts`（`POST /auth/nonce`、`POST /auth/verify`） |
| 数据库 schema（identities 按 provider 区分 `wallet_evm`/`wallet_solana`，auth_nonces 存链类型） | ✅ 已完成 | `packages/db/src/schema/identities.ts`、`packages/db/src/schema/auth-nonces.ts`、`packages/shared/src/enums.ts`（`CHAIN=["evm","solana"]`） |
| 前端 API 客户端（`requestNonce`/`verifySignature` 及类型） | ✅ 已完成 | `apps/web/src/server-api-module/auth/mutations.ts`、`.../auth/types.ts` |
| 前端钱包连接 UI | ❌ **纯样式桩**，点击只弹 Toast「钱包登录即将开放」 | `apps/web/src/app/_shared/ui-components/login-dialog/wallet-login.tsx` |
| 技术选型决策 | ✅ 已定（2026-09-19）：Reown AppKit（`wagmi` adapter + `solana` adapter），一个弹窗同时列出两条链的钱包，关掉 AppKit 自带的邮箱/社交登录和 SIWX，签名走我们自己的 nonce/verify | `docs/design/05-frontend-design.md:21,487-491`、`docs/frontend/README.md:225-230` |
| 阻塞条件（Reown Project ID） | ✅ **已解除**：本地 `apps/web/.env` 已配置 `NEXT_PUBLIC_REOWN_PROJECT_ID`，`.env.schema`/`env.ts` 已声明该变量 | `apps/web/.env`、`apps/web/.env.schema:14`、`apps/web/src/env.ts:22-25,39` |

`HANDOFF.md:122,225` 记录的阻塞原因（"等用户申请 Reown Project ID，拿到后一次做完"）在采集需求时核实**已经解除**——因此这次不是重新设计，而是把已经定稿、只差临门一脚的 M05 钱包登录任务做完。

## 需求详情

### R-001: EVM 钱包连接与登录
用户在登录弹窗的"钱包登录" tab 点击后，弹出 Reown AppKit 弹窗，可选择任意 EVM 钱包（MetaMask、OKX、WalletConnect 扫码等）完成连接、签名 SIWE 消息、换取 JWT 并登录成功。

### R-002: Solana 钱包连接与登录
同一个 Reown AppKit 弹窗中可选择 Solana 钱包（Phantom、Solflare 等），完成连接、签名 SIWS 消息、换取 JWT 并登录成功。

### R-003: 钱包登录的错误处理
用户在钱包内拒绝签名、nonce 过期、签名校验失败等场景下，登录弹窗给出明确的中文提示，且不产生"卡住无反馈"的状态。

### R-004: 与既有登录体系行为一致
钱包登录成功后的账户行为（token 存储、`isNew` 首次开户提示、`/auth/me` 会话恢复）与邮箱/Google 登录复用同一套逻辑；退出登录**不**断开钱包连接；三种登录方式互相独立开户（钱包地址变更 = 不同账户）。

### R-005: 加载性能
Reown AppKit 相关代码与依赖懒加载，只在用户点击"钱包登录" tab 时才加载，不影响首屏（`/` 首页、`/trade` 交易页）性能。

## 验收标准

### AC-001: EVM 钱包成功登录（Happy Path）
- **关联需求**: R-001
- **场景维度**: happy-path
- **Given**: 用户未登录，浏览器已注入 EVM 钱包 provider（如测试环境的 mock EIP-1193 provider）
- **When**: 打开登录弹窗 → 切到"钱包登录" tab → 点击连接 → 在 AppKit 弹窗选择该钱包 → 完成连接 → 钱包对 SIWE message 签名 → 前端提交签名
- **Then**: 依次调用 `POST /auth/nonce`（`chain: "evm"`）→ 钱包签名 → `POST /auth/verify` 成功返回 200 + `{token, account:{id, isNew}}`；登录弹窗关闭，顶栏显示余额和昵称（脱敏地址，如 `0x12ab…cdef`）
- **验证方式**: playwright-mcp（注入 mock EIP-1193 provider）+ unit

### AC-002: Solana 钱包成功登录（Happy Path）
- **关联需求**: R-002
- **场景维度**: happy-path
- **Given**: 用户未登录，浏览器已注入 Solana 钱包 provider（如测试环境的 mock wallet-standard provider）
- **When**: 同 AC-001 流程，在 AppKit 弹窗选择 Solana 钱包并签名 SIWS message
- **Then**: `POST /auth/nonce`（`chain: "solana"`）→ 钱包签名 → `POST /auth/verify` 成功返回 200，登录弹窗关闭，顶栏显示登录态
- **验证方式**: playwright-mcp（注入 mock Solana provider）+ unit

### AC-003: 用户在钱包内拒绝签名（Error）
- **关联需求**: R-003
- **场景维度**: error
- **Given**: 已完成钱包连接，`POST /auth/nonce` 已返回 message
- **When**: 钱包签名请求被用户拒绝（provider 返回拒绝错误）
- **Then**: 登录弹窗内显示明确文案（如"已取消签名"），不关闭弹窗、不清空已连接的钱包地址，允许用户重新发起签名
- **验证方式**: playwright-mcp（mock provider 模拟拒绝）

### AC-004: nonce 已过期（Error）
- **关联需求**: R-003
- **场景维度**: error
- **Given**: `POST /auth/nonce` 返回的 `expiresAt` 已过（服务端 5 分钟 TTL，见 `packages/db/src/schema/auth-nonces.ts`）
- **When**: 提交签名调用 `POST /auth/verify`
- **Then**: 服务端返回对应错误码，前端原样显示服务端中文 message（如"签名已过期，请重新连接"），并允许用户重新发起 nonce 申请
- **验证方式**: playwright-mcp + unit（mock 接口返回过期错误）

### AC-005: 签名校验失败（Error）
- **关联需求**: R-003
- **场景维度**: error
- **Given**: 提交的签名与 `address`/`message` 不匹配（如 mock provider 故意返回错误签名）
- **When**: `POST /auth/verify` 返回 401
- **Then**: 前端显示服务端返回的中文错误信息，不写入 token，不跳转
- **验证方式**: unit + playwright-mcp

### AC-006: 断线/未安装钱包（Boundary）
- **关联需求**: R-001, R-002
- **场景维度**: boundary
- **Given**: 用户设备未安装任何 EVM/Solana 钱包扩展，也未扫码连接 WalletConnect
- **When**: 打开 AppKit 弹窗
- **Then**: AppKit 弹窗自身给出"未检测到钱包/请安装"引导（原生能力），不需要额外自定义兜底逻辑；页面不因此报错崩溃
- **验证方式**: manual（无法在无扩展的无头浏览器环境完整复现该分支，见「设计假设」）

### AC-007: 退出登录不断开钱包（Boundary）
- **关联需求**: R-004
- **场景维度**: boundary
- **Given**: 用户已用钱包登录成功
- **When**: 点击"退出登录"
- **Then**: 应用内 token 清除、账户数据清空、WS 断开重连；但 AppKit/钱包本身保持连接状态（下次点击登录能直接复用已连接的钱包，无需重新走连接授权）
- **验证方式**: playwright-mcp

### AC-008: 钱包登录不影响首屏性能（UI State / 性能）
- **关联需求**: R-005
- **场景维度**: ui-state
- **Given**: 用户首次访问首页 `/`，未点击登录弹窗
- **When**: 页面加载完成
- **Then**: `@reown/appkit` 及其适配器相关 JS chunk 不在首屏加载的网络请求列表中（懒加载验证），首屏行为与本次改动前一致
- **验证方式**: playwright-mcp（`list_network_requests` 断言不含 appkit chunk）

### AC-009: 连接中/签名中状态可见（UI State）
- **关联需求**: R-001, R-002
- **场景维度**: ui-state
- **Given**: 用户点击连接钱包后
- **When**: 处于"等待钱包连接"或"等待钱包签名"或"校验中"的中间状态
- **Then**: 按钮/弹窗显示对应的加载态文案（如"连接中…"/"等待签名…"/"登录中…"），按钮禁用，避免重复点击触发多次 nonce 申请
- **验证方式**: playwright-mcp

### AC-010: 签名原文不被前端篡改（Security）
- **关联需求**: R-001, R-002
- **场景维度**: security
- **Given**: `POST /auth/nonce` 返回的 `message` 字段
- **When**: 前端把该字段交给钱包签名
- **Then**: 前端**原样**传递服务端返回的 `message`，不自行拼接或修改任何字符（`types.ts` 注释已强调"原样交给钱包，不要自己拼"），避免签名内容与服务端校验内容不一致
- **验证方式**: unit（断言传给签名函数的字符串与 nonce 响应的 message 全等）

### AC-011: 不同链地址不可互相冒用（Security）
- **关联需求**: R-004
- **场景维度**: security
- **Given**: 用户已连接一个 EVM 地址 A
- **When**: 切换到 Solana 钱包连接地址 B 并登录
- **Then**: 服务端按 `(provider, providerId)` 唯一索引识别为不同身份/账户（`packages/db/src/schema/identities.ts:39`），前端不得把两次登录混同为同一账户会话
- **验证方式**: unit（后端已覆盖，前端只需不做额外的"合并"逻辑；此处为回归性 AC，防止本次改动引入错误合并）

## 非功能性需求

| ID | 类别 | 描述 | 验收指标 |
|----|------|------|----------|
| NFR-001 | 性能 | AppKit 懒加载，不阻塞首屏 | 首屏（未打开登录弹窗）网络请求不含 `@reown/appkit` 相关 chunk |
| NFR-002 | 安全 | 签名原文不经前端篡改；JWT payload 不含身份细节 | 见 AC-010；沿用 `apps/server/src/auth/tokens.ts` 现有实现，本次不改动 |
| NFR-003 | 兼容性 | 覆盖桌面浏览器主流 EVM 扩展钱包（MetaMask 等）与 Solana 扩展钱包（Phantom 等）；移动端走 WalletConnect 扫码（AppKit 原生能力） | 由 AppKit 官方钱包列表覆盖，不额外裁剪，见「需求边界」 |
| NFR-004 | 可访问性 | 沿用登录弹窗现有 `aria-label`/`role="alert"` 规范 | 新增的错误提示复用 `role="alert"` 模式（参考 `email-login.tsx:122-126`） |

## 需求边界

### 包含 (In Scope)
- 用 Reown AppKit（`wagmi` adapter + `solana` adapter）把"钱包登录" tab 从样式桩接成真实的"连接 → 签名 → 验证 → 登录"链路
- EVM 与 Solana 两条链的连接、签名、错误处理
- 懒加载改造，保证不拖慢首屏
- 单元测试与浏览器验收（mock provider 方式，见「设计假设」）

### 不包含 (Out of Scope)
- 不做"一个账户绑定多个钱包地址"或"钱包地址与邮箱/Google 账户合并"——这是已经定稿的产品决策（`docs/design/00-overview.md`、`.claude/SECURITY.md:8`：三种方式互相独立，不做账户合并），本次不重新讨论
- 不裁剪/定制 AppKit 弹窗内置的钱包列表（沿用官方默认列表）
- 不涉及后端 `wallet.ts`/`routes.ts`/DB schema 改动——这些已完成且有测试覆盖，本次视为稳定依赖
- 不做真实钱包扩展（MetaMask/Phantom 实体插件）下的人工点击验收——那是 `qa` 阶段配合用户本人验收的范畴（`HANDOFF.md` 遗留事项第 2 条），proposal/apply 阶段只保证代码逻辑和可自动化的 mock 验证

### 未来考虑 (Future Considerations)
- 是否支持同一账户绑定多个钱包地址（如需要，需先过 design.md 重新评估 identities 表的唯一索引设计）
- 是否需要限定/裁剪 AppKit 钱包白名单（如需要，属于产品决策，需用户明确提出）

## 用户故事

### US-001: 用钱包登录模拟盘
- **角色**: 作为一个想用自己钱包身份登录的用户
- **目标**: 我想要点击"钱包登录"后用 MetaMask 或 Phantom 完成连接和签名
- **价值**: 以便不用邮箱/Google 也能开户体验模拟交易
- **关联需求**: R-001, R-002, R-004

## UI/UX 约束

- **设计稿**: Figma 5:6852（钱包登录按钮样式，已实现且不改动）
- **交互规范**: 沿用 `docs/frontend/README.md:225-230` 已定的交互描述（连接 → 拿地址和链 → nonce → 签名 → verify → token）
- **响应式要求**: 沿用登录弹窗现有响应式行为（`w-[390px]` 固定宽度弹窗），不新增断点
- **动画/过渡**: 默认，不新增特殊动画

## 变更影响评估

- **Breaking Changes**: 否
- **数据库变更**: 否（`identities`/`auth_nonces` 表结构已支持，见「背景核实」）
- **API 变更**: 否（`/auth/nonce`、`/auth/verify` 已存在且本次不改动请求/响应结构）
- **配置变更**: 是——新增前端依赖（`@reown/appkit` 及其 wagmi/solana adapter、`wagmi`、`viem`、`@solana/web3.js` 等，具体见 design.md 5.3）；`NEXT_PUBLIC_REOWN_PROJECT_ID` 环境变量**已存在**，本次不新增

## 外部依赖

- 无外部文档/JIRA 链接；本次需求来自用户口述

## 假设标注

本次需求在采集阶段已通过读取代码与既有设计文档核实关键事实（见「背景核实」表），未发现需要交互式澄清的低置信度/设计影响项：技术选型、账户隔离策略、Project ID 可用性均已有明确出处，故本轮 proposal 未触发 AskUserQuestion。唯一需要在 design.md 中显式登记的是**测试策略假设**（无头浏览器环境不具备真实钱包扩展，如何验证连接/签名链路），见 design.md「设计假设」。
