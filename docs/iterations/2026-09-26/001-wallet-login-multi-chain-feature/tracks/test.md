# Test（⑦ 查漏，single 模式下由主 agent 扮演）

## 完成的任务

- [x] T-006: 单元测试查漏

## AC 覆盖核对表

| AC-ID | 场景维度 | 声明的验证方式 | unit 层覆盖情况 | 备注 |
|-------|----------|----------------|------------------|------|
| AC-001 | happy-path | playwright-mcp + unit | ✅ `sign-in.test.ts`（调用链/参数） | 浏览器渲染确认留给 qa（T-007） |
| AC-002 | happy-path | playwright-mcp + unit | ✅ `sign-in.test.ts` | 同上 |
| AC-003 | error | playwright-mcp | ✅ `sign-in.test.ts`（拒签→不发起 verify） | 声明验证方式本不含 unit，属额外覆盖 |
| AC-004 | error | playwright-mcp + unit | ✅ `sign-in.test.ts`（错误原样抛出） | UI 渲染确认留给 qa |
| AC-005 | error | unit + playwright-mcp | ✅ 同 AC-004 | 同上 |
| AC-006 | boundary | manual | — | 按定义就不追加自动化，代码审查确认未做多余判断 |
| AC-007 | boundary | playwright-mcp | ✅ `auth-store.test.ts`（新增） | 额外补的 unit 覆盖，比声明的验证方式更严格 |
| AC-008 | ui-state/性能 | playwright-mcp | ✅ 间接（`appkit-config.test.ts` 证明配置装配不在模块顶层执行副作用） | 网络请求断言本身留给 qa |
| AC-009 | ui-state | playwright-mcp | ✅ `sign-in.test.ts`（onStage 顺序） | 按钮禁用/防重复点击的 DOM 断言留给 qa |
| AC-010 | security | unit | ✅ `sign-in.test.ts`（EVM/Solana 各一条独立断言） | 完整覆盖，不依赖 qa |
| AC-011 | security | unit | ✅ `sign-in.test.ts`（新增，两次登录互不干扰） | 完整覆盖，不依赖 qa |

## 查漏时发现并处理的问题

1. **AC-011 缺一条直接断言**——原 T-004 任务描述里说"单测断言"，但实现时只是靠"代码里没写合并逻辑"这种消极证明。补了一条主动断言：连续两次不同链登录，`requestNonce`/`verifySignature` 的调用参数各自独立、两次返回的 `account.id` 不同。
2. **AC-007 同理**——`useAuthStore` 之前完全没有测试文件。新增 `auth-store.test.ts`，断言 `logout()` 只调用 `setToken(null)`。
3. **T-007（qa）原本漏了 AC-004/AC-005/AC-007 三个场景**——这三条 AC 在 requirements.md 里都声明需要 playwright-mcp（或至少不排除），但最初写 T-007 时只列了 5 个场景。已回补到 tasks.md 的 T-007。

## 回归执行

```
pnpm --filter web test    → 226/226 通过
pnpm --filter web lint    → 0 error / 0 warning
pnpm --filter web check-types → 通过
```

## 状态
- Track: test（unit-test） → done
