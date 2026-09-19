# 币种图标

来源：[`@web3icons/core`](https://web3icons.io) 4.0.56（npm 包 `package.json` 声明 `"license": "MIT"`，作者 0xa3k5；
上游仓库 https://github.com/0xa3k5/web3icons 没有单独的 LICENSE 文件）。2026-09-19 从包里的 `dist/svgs/tokens/background/` 取出。

文件名 = 基础币种（`SymbolSpec.baseAsset`），如 `BTC.svg`。代码里的可用清单在 `src/components/coin-icon.tsx` 的 `COIN_ICONS`，
加新币对时：从同一个包取 `<币种>.svg.js` 的默认导出存成 `<币种>.svg`，再把币种加进 `COIN_ICONS`。没加的显示字母头像。

为什么不用币安的图标：币安图片 CDN 开了防盗链（带我们域名的 Referer 返回 403），用户 2026-09-19 定改用开源图标。
