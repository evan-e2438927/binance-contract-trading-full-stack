import { request } from "@/lib/axios-client/client";

import type { Me } from "./types";

/** GET /auth/me：当前登录的账户。auth-store 恢复登录态时调 */
export const fetchMe = () => request.get<Me>("/auth/me");
