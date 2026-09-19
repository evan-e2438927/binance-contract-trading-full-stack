"use client";

import { cn } from "@binance-contract-trading-full-stack/ui/lib/utils";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { toApiError } from "@/lib/axios-client/api-error";
import { INITIAL_BALANCE_DISPLAY } from "@/lib/config/constants";
import { sendEmailCode, verifyEmailCode } from "@/server-api-module/auth/mutations";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";

import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";
import { useCountdown } from "./use-countdown";

/** 重新发送的间隔，和服务端的发送频率限制一致（60 秒） */
const RESEND_MS = 60_000;
const CODE_LENGTH = 6;
const emailSchema = z.email();

/**
 * L-03 邮箱验证码登录（Figma 5:7251）：邮箱 → 发送验证码（60 秒倒计时）→ 6 位验证码 → 确认登录。
 * 前端只自己判断邮箱格式；频率限制、验证码错误（含剩余次数）、过期都显示服务端的中文 message。
 * 设计稿里的「设置昵称（可选）」不做：登录接口不收昵称，改昵称放在 M06（spec 一·9）。
 */
export function EmailLogin() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  /** 验证码发到了哪个邮箱。发完再改输入框，登录仍用这个，避免拿 A 的码去登 B */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const countdown = useCountdown();
  const login = useAuthStore((s) => s.login);
  const setLoginOpen = useUiStore((s) => s.setLoginOpen);

  const canSubmit = sentTo !== null && code.length === CODE_LENGTH && !submitting;

  const send = async () => {
    const target = email.trim();
    if (!emailSchema.safeParse(target).success) {
      setEmailError("邮箱格式不正确");
      return;
    }
    setEmailError(null);
    setError(null);
    setSending(true);
    try {
      await sendEmailCode(target);
      setSentTo(target);
      countdown.start(RESEND_MS);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || sentTo === null) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await verifyEmailCode(sentTo, code);
      await login(result.token);
      if (result.account.isNew) toast.success(`开户成功，已发放 ${INITIAL_BALANCE_DISPLAY} USDT 模拟资金`);
      setLoginOpen(false);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  const sendLabel = sending
    ? "发送中…"
    : countdown.running
      ? `${countdown.seconds} 秒后重新发送`
      : sentTo
        ? "重新发送验证码"
        : "发送验证码";

  return (
    <form className="flex flex-col gap-2.5" onSubmit={submit} noValidate>
      <div>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="请输入邮箱地址"
          aria-label="邮箱地址"
          aria-invalid={emailError ? true : undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(null);
          }}
          className={INPUT}
        />
        {emailError && <p className="mt-1 text-[12px] text-down">{emailError}</p>}
      </div>
      <button type="button" className={SECONDARY_BUTTON} disabled={sending || countdown.running} onClick={send}>
        {sendLabel}
      </button>
      {sentTo && (
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={`请输入 ${CODE_LENGTH} 位验证码`}
          aria-label="验证码"
          maxLength={CODE_LENGTH}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
          className={cn(INPUT, "num tracking-[0.3em]")}
        />
      )}
      {error && (
        <p role="alert" className="text-[12px] text-down">
          {error}
        </p>
      )}
      <button type="submit" className={cn(PRIMARY_BUTTON, "p-[11px]")} disabled={!canSubmit}>
        {submitting ? "登录中…" : "确认登录"}
      </button>
    </form>
  );
}
