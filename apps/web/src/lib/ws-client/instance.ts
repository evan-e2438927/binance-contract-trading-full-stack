import { WS_URL } from "@/lib/config/env";

import { WsClient } from "./ws-client";

/** 全局唯一的 WS 连接。只在浏览器里用（providers/ws-bridge 负责 connect） */
export const wsClient = new WsClient(WS_URL);
