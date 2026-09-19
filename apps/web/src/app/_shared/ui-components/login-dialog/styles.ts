/** 登录弹窗里三个 tab 共用的样式（Figma 5:6852 / 5:7251 / 5:7654） */

/** 黄色大按钮：连接钱包、Google 登录、确认登录 */
export const PRIMARY_BUTTON =
  "flex w-full items-center justify-center gap-2.5 rounded-[6px] bg-brand p-3.5 font-bold text-[14px] text-black leading-[21px] transition-colors hover:bg-brand/80 disabled:pointer-events-none disabled:opacity-50";

/** 深色描边按钮：发送验证码 */
export const SECONDARY_BUTTON =
  "flex w-full items-center justify-center rounded-[6px] border bg-surface px-3 py-2.5 text-[13px] text-foreground leading-[19.5px] transition-colors hover:border-brand/40 disabled:pointer-events-none disabled:text-muted-foreground";

/** 输入框 */
export const INPUT =
  "h-[41.5px] w-full rounded-[6px] border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-foreground/50 focus:border-brand aria-invalid:border-down";
