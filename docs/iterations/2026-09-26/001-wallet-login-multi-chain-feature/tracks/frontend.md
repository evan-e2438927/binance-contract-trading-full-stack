# Frontend（⑥.2，single 模式下由主 agent 扮演）

## 完成的任务

- [x] T-002: AppKit 懒加载配置模块
- [x] T-003: EVM 钱包连接登录主链路
- [x] T-004: Solana 钱包连接登录主链路
- [x] T-005: 错误处理与加载态 UI

（详细的实现偏差、AC 逐条核对结果见 `tasks.md` 各任务小节；这里只汇总文件与关键决策，不重复。）

## 实现前的准备：核对已安装的 @reown/appkit@1.8.24 真实 API

design.md 的 ASM-D02 把"具体 hook/方法名"标成设计假设，要求 apply 阶段对照已安装版本核实。实现前读了：

- `@reown/appkit/react` 的 `.d.ts`：`createAppKit`/`AppKitProvider`/`useAppKit`/`useAppKitAccount`/`useAppKitProvider`/`useAppKitState`
- `@reown/appkit-controllers` 的 `Provider` 接口（EVM，`request<T>(args)`）
- `@reown/appkit-utils/solana` 的 `Provider` 接口（Solana，`signMessage(Uint8Array): Promise<Uint8Array>`）
- `AppKitProvider` 的真实源码（`dist/esm/src/library/react/providers.js`）：确认它**不是**真正的 React Context Provider，只是在渲染时调用一次模块级单例的 `createAppKit()`（`memoizeCreateAppKit`），然后直接 `return children`——这意味着 hooks 读的是全局 valtio store，不依赖 React 树位置，也意味着**不需要**额外包 `QueryClientProvider`（design.md 决策记录已撤销这条错误假设）

这一步核实避免了凭记忆编 API（`CLAUDE.md`"宁可说做不到，不要编数字"同样适用于不确定的第三方库 API）。

## 关键实现决策

1. **懒加载边界=文件边界**：`wallet-login.tsx`（原样式桩）现在只是 `next/dynamic(() => import(".../wallet-connect-panel"), {ssr:false})` 的壳；真正 import `@reown/appkit/*` 的代码全部在 `wallet-connect-panel.tsx` + `appkit-config.ts`，两者都不会被任何首屏路径静态 import。
2. **`AppKitProvider` 只包这一个组件的子树**，不改 `apps/web/src/providers/index.tsx`（应用根 Provider 树）。
3. **状态机**：`wallet-connect-panel.tsx` 内部 `stage: idle|connecting|signing|verifying`，`processedAddress` ref 防止同一次连接重复触发签名；`retry()` 允许拒签后原地重试而不重新连接钱包。
4. **`sign-in.ts` 保持零 UI/零 React 依赖**，纯编排 + 两个链的签名适配器 + 拒签判定，方便单测，也符合 `packages/engine` 之外的其它代码"能不依赖重的东西就不依赖"的项目气质（虽然这里不是 `packages/engine`，不受硬约束，但保持一致的工程习惯）。

## 修改的文件

- `apps/web/src/app/_shared/ui-components/login-dialog/wallet-login.tsx`（改造：样式桩 → 懒加载壳）
- `apps/web/src/lib/wallet/appkit-config.ts`（新增）
- `apps/web/src/lib/wallet/wallet-connect-panel.tsx`（新增）
- `apps/web/src/lib/wallet/sign-in.ts`（新增）

## 新增的测试

- `apps/web/src/lib/wallet/appkit-config.test.ts`（新增，4 用例）
- `apps/web/src/lib/wallet/sign-in.test.ts`（新增，11 用例）
- `apps/web/src/stores/auth-store.test.ts`（新增，1 用例——这个 store 之前完全没有测试）

## 修复记录（2026-09-27，用户实测发现）

用户本地跑起来后，点连接钱包弹窗提示"没有 project id"。排查发现 `appkit-config.ts` 最初写的是
`import { ENV } from "@/env"`（varlock 生成的类型化 `ENV` proxy）——这是全 `apps/web` 里**唯一**引用
`@/env` 的地方。核对代码库实际约定后发现：这个项目暴露 `NEXT_PUBLIC_*` 给浏览器端的**真实**做法是
`apps/web/src/lib/config/env.ts` 里 `process.env.NEXT_PUBLIC_SERVER_URL` 这种字面量写法（该文件注释明写
"NEXT_PUBLIC_* 在构建时内联进前端包"）——这是 Next.js 的标准机制：webpack 在构建时静态扫描字面量
`process.env.NEXT_PUBLIC_X` 并替换成实际值，但**看不穿** varlock `ENV` 这层 Proxy 间接访问，所以在浏览器里
`ENV.NEXT_PUBLIC_REOWN_PROJECT_ID` 解析不到值。

修复：在 `lib/config/env.ts` 新增 `REOWN_PROJECT_ID`（同款字面量写法），`appkit-config.ts` 改为从这里取值，
不再依赖 `@/env`。`appkit-config.test.ts` 同步改了 mock 对象。修复后 `pnpm --filter web check-types` /
`test`（226/226）/ `lint` 均通过。这个坑本可以在实现阶段发现（写代码前应该先查一遍项目里其它地方是怎么读
`NEXT_PUBLIC_*` 的，而不是想当然用看起来"更类型安全"的 `@/env`），记录下来避免下次重犯。

## 已知遗留（不属于本次改动引入，如实记录）

`pnpm --filter server test` 现有 `src/ws/hub.test.ts` 5 条用例失败（`AssertionError: expected [] to deeply equal [...]`）。核实：
- `apps/server/src/ws/hub.test.ts` 本身未被本迭代改动
- 失败原因指向 `apps/server/src/ws/serialize.ts` / `apps/server/src/ws/publisher.test.ts`——这两个文件在本次 apply **开始前**就已经是 modified 状态（属于用户此前未提交的另一项工作），本次没有触碰
- 本迭代范围是纯前端钱包登录，`apps/server` 全程未修改；该失败与钱包登录改动无关，不在本次 test-pipeline 范围内，如实上报给用户，不代为修复

## 状态
- Track: frontend → done
