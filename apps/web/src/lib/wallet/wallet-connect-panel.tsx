"use client";

import {
  AppKitProvider,
  type Provider,
  useAppKit,
  useAppKitAccount,
  useAppKitProvider,
  useAppKitState,
} from "@reown/appkit/react";
import type { Provider as SolanaProvider } from "@reown/appkit-utils/solana";
import { useCallback, useEffect, useRef, useState } from "react";

import { PRIMARY_BUTTON } from "@/app/_shared/ui-components/login-dialog/styles";
import { toApiError } from "@/lib/axios-client/api-error";
import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { notify } from "@/lib/toast/notify";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { getWalletAppKitConfig } from "./appkit-config";
import { evmSignMessage, isUserRejection, signInWithWallet, solanaSignMessage } from "./sign-in";

type Stage = "idle" | "connecting" | "signing" | "verifying";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  connecting: "连接中…",
  signing: "等待签名…",
  verifying: "登录中…",
};

/**
 * 真正接了 Reown AppKit 的连接按钮（这个模块整体懒加载，见 wallet-login.tsx）。
 * 一个弹窗同时列 EVM 和 Solana 钱包（docs/design/05-frontend-design.md:489/491）：
 * 弹窗关掉后 `useAppKitAccount` 两条链谁先连上就走谁，不用用户先选链。
 */
function ConnectButton() {
  const { open } = useAppKit();
  const { open: modalOpen } = useAppKitState();
  const evmAccount = useAppKitAccount({ namespace: "eip155" });
  const solanaAccount = useAppKitAccount({ namespace: "solana" });
  const { walletProvider: evmProvider } = useAppKitProvider<Provider>("eip155");
  const { walletProvider: solanaProvider } = useAppKitProvider<SolanaProvider>("solana");

  const login = useAuthStore((s) => s.login);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  /** 避免同一次连接触发两遍签名流程（effect 依赖变化 / 组件重渲染都可能重新跑） */
  const processedAddress = useRef<string | null>(null);

  const connected =
    solanaAccount.isConnected && solanaAccount.address
      ? { chain: "solana" as const, address: solanaAccount.address }
      : evmAccount.isConnected && evmAccount.address
        ? { chain: "evm" as const, address: evmAccount.address }
        : null;

  const attemptSignIn = useCallback(
    async (chain: "evm" | "solana", address: string) => {
      setError(null);
      setStage("signing");
      const signMessage = chain === "evm" ? evmSignMessage(evmProvider, address) : solanaSignMessage(solanaProvider);
      try {
        const result = await signInWithWallet({ chain, address, signMessage, onStage: setStage });
        await login(result.token);
        if (result.account.isNew) notify.success(`开户成功，已发放 ${INITIAL_BALANCE_DISPLAY} USDT 模拟资金`);
        setLoginOpen(false);
      } catch (e) {
        // 拒签：钱包仍保持连接，允许原地重试（AC-003）；其余错误原样显示服务端中文 message（AC-004/AC-005）
        setError(isUserRejection(e) ? "已取消签名，可重新发起签名" : toApiError(e).message);
      } finally {
        setStage("idle");
      }
    },
    [evmProvider, solanaProvider, login, setLoginOpen],
  );

  // 弹窗被用户关掉但没连上钱包：从"连接中"退回初始态，不留假死按钮
  useEffect(() => {
    if (!modalOpen && stage === "connecting" && !connected) setStage("idle");
  }, [modalOpen, stage, connected]);

  // 钱包刚连上（不管哪条链）：自动发起签名流程，用户不用再多点一次。
  // connected 每次渲染都是新对象，这个 effect 因此可能跑得比"地址真正变化"更频繁，
  // 但 processedAddress ref 会挡掉重复触发，多跑几次 effect 本身无害。
  useEffect(() => {
    if (!connected) return;
    if (processedAddress.current === connected.address) return;
    processedAddress.current = connected.address;
    void attemptSignIn(connected.chain, connected.address);
  }, [connected, attemptSignIn]);

  const retry = () => {
    if (!connected) return;
    void attemptSignIn(connected.chain, connected.address);
  };

  const busy = stage !== "idle";

  if (connected && error) {
    return (
      <div className="flex flex-col gap-2.5">
        <p role="alert" className="text-[12px] text-down">
          {error}
        </p>
        <button type="button" className={PRIMARY_BUTTON} onClick={retry}>
          重新签名
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        className={PRIMARY_BUTTON}
        disabled={busy}
        onClick={() => {
          setError(null);
          setStage("connecting");
          void open();
        }}
      >
        <span aria-hidden className="text-[18px] leading-[27px]">
          🔗
        </span>
        {busy ? STAGE_LABEL[stage] : "连接 Web3 钱包"}
      </button>
      {error && (
        <p role="alert" className="text-[12px] text-down">
          {error}
        </p>
      )}
    </div>
  );
}

export default function WalletConnectPanel() {
  return (
    <AppKitProvider {...getWalletAppKitConfig()}>
      <ConnectButton />
    </AppKitProvider>
  );
}
