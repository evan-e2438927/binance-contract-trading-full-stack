---
name: figma-asset-restore
description: 在 monorepo 前端工程中从 Figma 还原设计稿时使用：读取设计稿、下载素材、PNG 转 WebP、按目录规范存放并用静态 import 引用资源。
---

# Figma 设计还原与素材落地规范

适用于 monorepo 前端工程（Next.js / Vite / Webpack 等）中把 Figma 设计稿还原成代码。
下文用 `{模块}`、`{页面}` 表示业务模块和页面，例如 `activity/pc`、`lottery/h5`；用 `{应用}` 表示 `apps/` 下的应用，默认是 `web`。
所有路径和命令均相对于 **monorepo 根目录**。

## 0. 先确认项目约定

开工前先看项目里有没有已有约定（README、CLAUDE.md、docs 等），有则以项目约定为准。没有则使用以下默认目录：

| 用途 | 默认目录 | 是否参与打包 |
| --- | --- | --- |
| 验收截图（设计稿截图、拆解图） | `docs/requirements/{模块}/figma-screenshots/` | 否 |
| PNG 源文件（可追溯原始素材） | `docs/assets/{模块}/{页面}/` | 否 |
| 运行时素材（WebP / SVG） | `apps/{应用}/src/assets/{模块}/{页面}/`（默认 `apps/web/src/assets/...`） | 是 |

- 页面维度明确时用 `{模块}/{页面}`；用户指定只到模块级时用 `{模块}`。
- 需求属于其他应用（如 `apps/admin`、`apps/h5`）时，运行时素材放进对应应用的 `src/assets`；`docs/` 目录统一放在仓库根目录。
- 跨应用共用的素材，如果项目已有共享包（如 `packages/ui/src/assets`），放进共享包，不要在多个应用里各存一份。
- 用户明确指定了其他目录时，按用户说的来。

## 1. 开始前：必须先读取设计稿

不允许凭猜测实现。先用 Figma MCP 读取：

- `get_design_context`：尺寸、颜色、字体、间距等 token
- `get_metadata`：图层结构，用于确认要导出的节点
- `get_screenshot`：设计稿截图，存到验收截图目录，仅作对比参考，不作为运行时素材

从 Figma 链接解析 `fileKey` 和 `nodeId`（`node-id=1-2` 需转为 `1:2`）。

## 2. 先复用，再下载

下载新素材前，先检查 `apps/{应用}/src/assets/{模块}/{页面}`（以及相邻模块、应用内公共 assets、共享包 assets）中是否已有可复用资源。能用 CSS 变换得到的，不再下载：

| 效果 | CSS 实现 |
| --- | --- |
| 水平镜像 | `transform: scaleX(-1)` |
| 垂直翻转 | `transform: scaleY(-1)` |
| 旋转 | `transform: rotate(90deg / 180deg)` |
| 换色 | `filter: hue-rotate()` / `mix-blend-mode` |
| 缩放 | CSS `width` / `height`（SVG 天然支持） |

例：左右对称的装饰只下载一侧，另一侧用 `scaleX(-1)`。

纯色、简单渐变、圆角、阴影、边框优先用 CSS 实现，不导出图片。

## 3. 格式优先级

1. **SVG**：图标、Logo、矢量插图，首选。
2. **透明背景 PNG**：人物、贴纸、带透明区域的合成素材，必须保留 Alpha 通道，不能导出成带白底/黑底的图。
3. **JPG**：仅用于无透明需求的照片类素材（一般也会再转 WebP）。

复杂渐变或图片合成的背景图导出 PNG。

### 透明背景检查（用 `download_assets` 导出 PNG 时）

- 该工具导出格式取节点的 export setting，否则默认 `png`（scale 1），没有"透明"开关，透明与否取决于导出节点自身有没有不透明背景填充。
- 下载前用 `get_metadata` / `get_design_context` 确认导出的是目标图层本身，而不是带底色的外层 Frame/Group；如果目标被包在有底色的容器里，改为导出更内层、无背景填充的节点。
- 下载后检查 PNG 确实有透明区域，例如：
```bash
  python3 -c "from PIL import Image; im=Image.open('x.png'); print(im.mode, im.getextrema())"
```
  `mode` 应为 `RGBA`，且 alpha 通道最小值小于 255。确认无误再存入 PNG 源文件目录。
- 需要高清图时（如 2x 屏），导出 scale 2 并在 CSS 中按 1x 尺寸显示。

## 4. PNG → WebP 转换

所有 PNG 下载后必须转 WebP，代码不直接引用 PNG。PNG 源文件保留在源文件目录，便于重新转换和对比。

先确认本机有 `cwebp`（macOS：`brew install webp`），没有时可用 `ffmpeg` 或 Python Pillow 代替。

```bash
# 单文件
cwebp -q 90 -alpha_q 100 docs/assets/{模块}/{页面}/input.png -o apps/web/src/assets/{模块}/{页面}/input.webp

# 批量
SRC=docs/assets/{模块}/{页面}
DST=apps/web/src/assets/{模块}/{页面}
mkdir -p "$DST"
for f in "$SRC"/*.png; do
  cwebp -q 90 -alpha_q 100 "$f" -o "$DST/$(basename "${f%.png}").webp"
done
```

参数选择：

- 背景图、全幅图：`-q 85`
- 小图标、贴纸（保细节）：`-q 90`
- 带透明通道：加 `-alpha_q 100`，转完检查透明边缘没有压缩瑕疵

SVG 不转换，直接放入运行时目录。

## 5. 资源引用方式

- 运行时组件必须用静态 `import` 引用本应用 `apps/{应用}/src/assets/...`（或共享包）下的本地资源。
- `@/assets/...` 这类别名指向当前应用的 `src`（以该应用的 `tsconfig.json` paths 为准），不要用 `../../../` 跨应用相对路径引用其他应用的素材。
- 禁止把需要打包的业务素材放进 `apps/{应用}/public/` 再用 `/xxx.png` 绝对路径引用（不走构建、无 hash、无法校验是否存在）。
- 禁止在代码中使用 Figma 返回的临时 asset URL，它只用于下载，过期即失效。

按框架区分 import 结果：

```tsx
// Next.js：静态导入得到对象，用 .src
import bg from '@/assets/activity/pc/bg.webp';
const sx = { backgroundImage: `url(${bg.src})` };
<img src={bg.src} alt="" />
// 或 <Image src={bg} alt="" />

// Vite / Webpack：静态导入直接得到 URL 字符串
import bg from '@/assets/activity/pc/bg.webp';
const style = { backgroundImage: `url(${bg})` };
```

避免：

```tsx
<img src="/activity/bg.png" />                                // public 路径 + PNG
const track = 'https://www.figma.com/api/mcp/asset/xxxx';      // Figma 临时 URL
```

## 6. 收尾自检清单

- [ ] 已读取设计稿，截图存入验收截图目录
- [ ] 新素材下载前已检查可复用资源
- [ ] 能用 CSS 实现的没有导出成图片
- [ ] 透明素材确认带 Alpha 通道
- [ ] PNG 已转 WebP，PNG 源文件保留在源文件目录
- [ ] 代码只引用本应用 `src/assets`（或共享包）下的 WebP / SVG，且为静态 import
- [ ] 代码中没有 Figma 临时 URL、没有 `public/` 业务素材路径
- [ ] 对照设计稿截图检查过尺寸、颜色、间距