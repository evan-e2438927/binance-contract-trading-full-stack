/**
 * 服务端地址。NEXT_PUBLIC_* 在构建时内联进前端包。
 * WS 地址从 HTTP 地址推出来（服务端把 WS 挂在同一个端口的 /ws 上，ws/server.ts），不单独配。
 */
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

export const WS_URL = `${SERVER_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws`;

/** TradingView Charting Library 静态文件的位置（public/charting_library，不进 git） */
export const CHARTING_LIBRARY_PATH = "/charting_library/";
