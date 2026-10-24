import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@binance-contract-trading-full-stack/ui/components/button", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import AppError from "../../../../apps/web/src/app/error";
import GlobalError from "../../../../apps/web/src/app/global-error";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  captureException.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const findButton = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;

describe("app/error.tsx (AppError)", () => {
  it("AC-008: 挂载时 captureException 1 次且 digest tag 为 abc，兜底文案仍在", () => {
    const error = Object.assign(new Error("x"), { digest: "abc" });
    act(() => root.render(<AppError error={error} reset={vi.fn()} />));
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toEqual({ tags: { digest: "abc" } });
    expect(container.textContent).toContain("页面出错了");
    expect(container.textContent).toContain("重试");
    expect(container.textContent).toContain("返回首页");
  });

  it("AC-008a: 无 digest 时不带 tag", () => {
    act(() => root.render(<AppError error={new Error("x")} reset={vi.fn()} />));
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("AC-010: captureException 抛错时不崩溃，点击重试调用 reset 1 次", () => {
    captureException.mockImplementation(() => {
      throw new Error("sdk down");
    });
    const reset = vi.fn();
    act(() => root.render(<AppError error={new Error("x")} reset={reset} />));
    expect(container.textContent).toContain("页面出错了");
    act(() => findButton("重试").click());
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("app/global-error.tsx (GlobalError)", () => {
  it("AC-009: 挂载时 captureException 1 次，含「页面出错了」与「重试」按钮", () => {
    const reset = vi.fn();
    // GlobalError 渲染 <html>，在 jsdom 容器里会有嵌套警告，已 mock console.error
    act(() => root.render(<GlobalError error={new Error("x")} reset={reset} />));
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("页面出错了");
    act(() => findButton("重试").click());
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
