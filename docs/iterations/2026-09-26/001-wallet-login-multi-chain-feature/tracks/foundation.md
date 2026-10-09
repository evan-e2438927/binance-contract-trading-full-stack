# Foundation（⑥.1，主 agent）

## 完成的任务

### [x] T-001: 安装钱包相关依赖

按 design.md 5.3 安装到 `apps/web`：

| 包名 | 安装版本约束 |
|------|--------------|
| @reown/appkit | ^1.8.24 |
| @reown/appkit-adapter-wagmi | ^1.8.24 |
| @reown/appkit-adapter-solana | ^1.8.24 |
| wagmi | ^3.7.7 |
| viem | ^2.56.9 |
| @solana/web3.js | ^1.99.0 |

**验收标准**：
- [x] `pnpm install` 成功，`apps/web/package.json` 新增 6 个依赖，`pnpm-lock.yaml` 同步更新
- [x] `pnpm --filter web check-types` 通过（`next typegen && tsc --noEmit`，无报错）

## 额外处理：pnpm 供应链构建脚本审批

安装引入的 4 个包（`@reown/appkit`、`bigint-buffer`、`bufferutil`、`utf-8-validate`）带 install/build 脚本，
被 `pnpm-workspace.yaml` 的 `allowBuilds` 供应链安全策略拦截（`ERR_PNPM_IGNORED_BUILDS`）。

**审查结论**（逐个读取实际脚本内容后判定，均为已知安全的标准行为，不涉及网络请求/任意代码下载）：
- `@reown/appkit`：`postinstall` 只运行本地脚本 `scripts/appkit-version-check.js`，纯本地文件读取 + 版本号比对（检测同项目内 `@reown/appkit-*` 系列包版本是否一致），无网络/exec 调用
- `bigint-buffer`：`install` 跑 `node-gyp rebuild` 编译原生绑定，失败时优雅降级为纯 JS 实现；`@solana/web3.js` 的常见传递依赖
- `bufferutil` / `utf-8-validate`：`install` 跑 `node-gyp-build` 加载/编译预构建的原生绑定，`ws` 生态标准做法

已将 `pnpm-workspace.yaml` 中这 4 项的占位值改为 `true`，重新 `pnpm install` 后原生绑定编译成功，`check-types` 通过。

## 补装：bs58（T-003/T-004 实现期间发现的遗漏依赖）

对照 `apps/server/src/auth/wallet.ts` 的 `verifyWalletSignature` 实现确认：Solana 签名校验要求 `signature` 是 **base58** 编码的 64 字节字符串（`bs58.decode(signature)`）。`@reown/appkit-utils/solana` 的 `Provider.signMessage()` 只返回原始 `Uint8Array`，前端必须自己编码。`node-linker=isolated` 下不能依赖 `@reown/appkit` 内部同名传递依赖，补装为 `apps/web` 的直接依赖：

```
pnpm --filter web add "bs58@^6.0.0"
```

安装顺利，无需 build 脚本审批。design.md 5.3 已同步补录。

## 补装：@reown/appkit-controllers、@reown/appkit-utils（类型引用需要，node-linker=isolated 不允许幽灵依赖）

`sign-in.ts`/`wallet-connect-panel.tsx` 用 `import type { Provider } from "@reown/appkit-controllers"` 和
`import type { Provider as SolanaProvider } from "@reown/appkit-utils/solana"` 做精确类型标注（EVM `request()` /
Solana `signMessage()` 的真实签名，来自实现前对已安装 `@reown/appkit@1.8.24` 源码的核对，见 design.md ASM-D02 的解决过程）。
`pnpm --filter web check-types` 报 `Cannot find module`——这两个包只是 `@reown/appkit` 的传递依赖，`node-linker=isolated`
不会把它们暴露给 `apps/web` 自己 import（哪怕只是类型）。补装为直接依赖：

```
pnpm --filter web add "@reown/appkit-controllers@^1.8.24" "@reown/appkit-utils@^1.8.24"
```

安装顺利，无需 build 脚本审批，`check-types` 通过。design.md 5.3 已同步补录。

## 修改的文件
- `apps/web/package.json`（新增依赖，含补装的 `bs58`、`@reown/appkit-controllers`、`@reown/appkit-utils`）
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`（`allowBuilds` 4 项占位符 → `true`）

## 新增的测试
- 无（本任务为纯依赖安装）

## 状态
- Track: infra → done
