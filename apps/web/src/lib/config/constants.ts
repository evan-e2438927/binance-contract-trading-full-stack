/** 进交易页默认打开的币对 */
export const DEFAULT_SYMBOL = "BTCUSDT";

/** 登录前所在页面，Google 整页跳转回来后要回到这里 */
export const RETURN_TO_KEY = "bct.returnTo";

/**
 * 开户发放的初始模拟资金（展示用）。服务端开户时写 INITIAL 流水，金额见 packages/db 的开户逻辑；
 * 这里只是文案，不参与任何计算。
 */
export const INITIAL_BALANCE_DISPLAY = "10,000";
