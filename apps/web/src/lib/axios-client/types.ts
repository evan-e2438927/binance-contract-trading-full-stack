/**
 * 服务端响应包络（apps/server/src/http/respond.ts）。所有 REST 接口都包一层，
 * client.ts 负责拆掉，调用方直接拿 data。
 */
export type Envelope<T> =
  | {
      /** 成功 */
      ok: true;
      /** 业务数据 */
      data: T;
    }
  | {
      /** 失败 */
      ok: false;
      error: {
        /** 错误码（packages/shared 的 ERROR_CODES） */
        code: string;
        /** 给用户看的中文说明，界面直接显示，不二次翻译 */
        message: string;
      };
    };
