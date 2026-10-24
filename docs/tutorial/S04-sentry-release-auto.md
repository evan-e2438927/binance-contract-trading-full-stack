# S04 · Sentry 版本号自动填：从 package.json 读

> 改动日期：2026-10-24　｜　范围：`apps/server`　｜　起因：`SENTRY_RELEASE` 每次手动填太麻烦

## 一句话

后端上报错误给 Sentry 时，会带一个**版本标签**。以前这个标签要手动写进 `SENTRY_RELEASE`，不写就没有；
现在不写时自动用 `apps/server/package.json` 里的 `version`，变成 `server@0.1.0` 这样的标签。

## 版本标签有什么用

可以把 Sentry 想成一个「错误收件箱」。每封错误信上贴一张版本标签，你就能回答这些问题：

- 这个错误是哪个版本开始出现的？
- 发了新版本之后，这个错误还在不在？

没有标签的话，所有错误混在一起，分不出新旧版本。

## 前后对比

| 情况 | 以前 | 现在 |
| --- | --- | --- |
| `SENTRY_RELEASE` 留空 | 没有版本标签 | 自动用 `server@0.1.0`（跟着 package.json 走） |
| `SENTRY_RELEASE=a1b2c3d` | 用 `a1b2c3d` | 还是用 `a1b2c3d`（手动填的优先） |
| 没配 `SENTRY_DSN` | Sentry 不启用 | 一样不启用，版本号用不到 |

## 为什么不直接在启动时读 package.json

设计文档（`docs/iterations/2026-10-24/001-sentry-error-monitoring-feature/design.md` 第 21 行）记过一个坑：
Docker 里是直接用 `node dist/index.mjs` 启动的，**不经过 npm/pnpm**，所以读不到「npm 帮你准备好的版本号」。

这次的做法是在**打包时**把版本号写进产物：

```
打包前：代码里写「去 package.json 拿 version」
打包后：dist/index.mjs 里直接是 var version = "0.1.0";
```

好比寄信时把版本号直接写在信封上，到哪里都看得到，不用再回头翻原件。打包工具只取了 `version` 这一个字段，
package.json 里的依赖列表等其他内容**没有**打进去（已检查产物确认）。

本地开发（`pnpm run dev:server`，用 tsx 直接跑源码）同样读得到，也验证过了。

## 以后发新版本怎么做

改 `apps/server/package.json` 的 `"version"`（比如 `0.1.0` → `0.2.0`），然后照常 `pnpm run deploy:server`。
Sentry 里就会出现新标签 `server@0.2.0`，`.env.docker` 里的 `SENTRY_RELEASE` 保持留空即可。

**要注意的一点**：如果忘了改 version 就重新部署，新旧代码会贴同一个标签，在 Sentry 里就分不开了。
如果觉得每次手动改版本号也嫌麻烦，后面可以换成「自动用 git 提交号」，需要时再说。

## 改了哪些文件

| 文件 | 改了什么 |
| --- | --- |
| `apps/server/src/observability/release.ts` | 新文件：决定用哪个版本标签（手动填的优先，否则用 package.json 的版本号） |
| `apps/server/src/index.ts` | 初始化 Sentry 时改用上面的结果 |
| `apps/server/.env.schema` | `SENTRY_RELEASE` 的注释改成「留空 = 自动用 package.json 版本号」 |
| `tests/unit/server/observability/release.test.ts` | 新测试：留空、空串、手动填、默认读 package.json 四种情况 |

## 怎么判断改得对不对

- 测试：`tests/unit/server/observability/` 下 4 个文件 20 个用例全部通过
- 打包产物 `apps/server/dist/index.mjs` 里能搜到 `var version = "0.1.0"`
- 类型检查有 4 个报错，都在 `packages/db/src/brackets/diff.ts`，这次没改过这个文件，是原来就有的问题
