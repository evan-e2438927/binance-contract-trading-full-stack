import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session/token", () => ({
  getToken: vi.fn().mockReturnValue(null),
  setToken: vi.fn(),
  onTokenChange: vi.fn(),
}));
vi.mock("@/server-api-module/auth/queries", () => ({
  fetchMe: vi.fn(),
}));

const { setToken } = await import("@/lib/session/token");
const { useAuthStore } = await import("../../../../apps/web/src/stores/auth-store");

describe("useAuthStore.logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AC-007 (boundary): 退出登录只清本地 token，不做任何钱包 disconnect —— 这个模块从不 import 任何 @reown/* 符号，没有可调用的 disconnect", () => {
    useAuthStore.getState().logout();

    expect(setToken).toHaveBeenCalledTimes(1);
    expect(setToken).toHaveBeenCalledWith(null);
  });
});
