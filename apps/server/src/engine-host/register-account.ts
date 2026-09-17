import type { EngineEvent, EngineInput } from "@binance-contract-trading-full-stack/engine";
import { parse, type AuthProvider, type Fixed } from "@binance-contract-trading-full-stack/shared";
import { randomUUID } from "node:crypto";
import type { PendingRegistration } from "../persistence/persist";

/** 开户发放的模拟 USDT（00-overview.md）。开户也走引擎的 registerAccount → INITIAL 流水，不直接写余额 */
export const INITIAL_WALLET_BALANCE: Fixed = parse("10000");

export interface NewAccountIdentity {
  provider: AuthProvider;
  providerId: string;
  nickname: string;
}

export interface AccountRegistrar {
  /** 新建账户：返回新账户 id。落库失败（包括身份撞唯一索引）时 reject，引擎已回滚 */
  register(identity: NewAccountIdentity): Promise<string>;
  /** 给 persistEvents 的 PersistContext 用：这个账户是不是正在注册、身份是什么 */
  pendingRegistrationOf(accountId: string): PendingRegistration | undefined;
}

/**
 * 开户（第 12 讲）：鉴权层只负责"证明你拥有这个身份"，建账户这件事交给引擎宿主排队做。
 *
 * 为什么不是"先插账户行和身份行，再 submit registerAccount"：两步之间进程被杀，库里就留下
 * 一个余额 0、没有 INITIAL 流水的账户——下次登录能查到身份，却再也拿不到那 10,000。
 * 现在的做法是把身份先记在内存里，registerAccount 产出的 INITIAL 流水落库时，persist.ts
 * 在同一个事务里把账户行、身份行、流水一起写进去：要么全有，要么全没有。
 *
 * 同一个身份并发首次登录：两个请求都没查到身份、都来注册，队列保证一前一后；
 * 后一个撞 identities_provider_uq，事务失败、引擎回滚，调用方重新查一次身份就能拿到前一个建好的账户。
 */
export function createAccountRegistrar(options: {
  submit: (input: EngineInput) => Promise<EngineEvent[]>;
  now: () => number;
}): AccountRegistrar {
  const pending = new Map<string, PendingRegistration>();

  return {
    async register(identity) {
      const accountId = randomUUID();
      pending.set(accountId, { ...identity, positionMode: "ONE_WAY" });
      try {
        await options.submit({
          t: "registerAccount",
          accountId,
          walletBalance: INITIAL_WALLET_BALANCE,
          positionMode: "ONE_WAY",
          ts: options.now(),
        });
      } finally {
        pending.delete(accountId);
      }
      return accountId;
    },
    pendingRegistrationOf(accountId) {
      return pending.get(accountId);
    },
  };
}
