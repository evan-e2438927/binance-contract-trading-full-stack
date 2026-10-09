/**
 * 系统模块（/system，不用登录）的 DTO。
 * 来源：design.md「## 3. 接口契约」GET /system/version。
 */

/** GET /system/version 响应 */
export interface System {
  /** 服务端版本号 */
  version: string;
  /** 服务端已运行时长，单位秒 */
  uptime: number;
}
