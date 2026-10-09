#!/usr/bin/env bash
# 清掉上一次没退干净的开发服务器（2026-09-20 加，起因见 docs/tutorial/S02-rate-limit-incident.md）。
#
# 为什么需要：turbo 给每个 task 单独开一个伪终端，task 落在**另一个进程组**里。
# 终端里按 Ctrl+C，SIGINT 只送到当前终端的前台进程组（pnpm / turbo），到不了服务器进程——
# 要靠 turbo 自己转发去杀。转发没成功，服务器就活下来了：没有终端（TTY 显示 ??）、
# 但 `tsx watch` 还在监听文件，**你一改代码它就再拉起一个服务器**。
#
# 攒上几个之后，每个都有自己的币安限流闸门，同一个 IP 被多份行情连接反复撞——
# 正是 S02 那次被封 IP 的助推器。
#
# 这个脚本挂在 predev 上：每次 `pnpm run dev` 之前自动清一遍，不用你记。
set -u

live_pgid=""
if live_pid=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1) && [ -n "$live_pid" ]; then
  live_pgid=$(ps -o pgid= -p "$live_pid" 2>/dev/null | tr -d ' ')
fi

killed=0
for w in $(pgrep -f "tsx/dist/cli.mjs watch src/index.ts" 2>/dev/null); do
  pgid=$(ps -o pgid= -p "$w" 2>/dev/null | tr -d ' ')
  [ -z "$pgid" ] && continue
  # 正在监听 3000 的那一套是活的（比如你开了两个终端），不动它
  [ -n "$live_pgid" ] && [ "$pgid" = "$live_pgid" ] && continue
  # 自己所在的进程组也不能杀——predev 本身就跑在将要启动的那套里
  [ "$pgid" = "$(ps -o pgid= -p $$ | tr -d ' ')" ] && continue
  started=$(ps -o lstart= -p "$w" 2>/dev/null | xargs)
  echo "[predev] 清理上次残留的开发服务器：进程组 ${pgid}（启动于 ${started}）"
  kill -TERM -"$pgid" 2>/dev/null || kill -TERM "$w" 2>/dev/null
  killed=$((killed + 1))
done

[ "$killed" -gt 0 ] && sleep 1
exit 0
