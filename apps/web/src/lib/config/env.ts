/**
 * 服务端地址。NEXT_PUBLIC_* 在构建时内联进前端包。
 * WS 地址从 HTTP 地址推出来（服务端把 WS 挂在同一个端口的 /ws 上，ws/server.ts），不单独配。
 */
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

export const WS_URL = `${SERVER_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws`;

/** Reown（WalletConnect）Project ID，cloud.reown.com 申请；钱包登录弹窗要用（lib/wallet/appkit-config.ts） */
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

/** TradingView Charting Library 静态文件的位置（public/charting_library，不进 git） */
export const CHARTING_LIBRARY_PATH = "/charting_library/";

/**
 * 浏览器端 Sentry DSN（构建期内联）。空串表示不启用错误上报。
 * 必须保持 process.env.NEXT_PUBLIC_* 字面量访问，Next 才会内联；不能改用 varlock 的 ENV 对象。
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
