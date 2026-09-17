import { decodeIdToken, generateCodeVerifier, generateState, Google } from "arctic";

/**
 * Google 登录：OAuth2 Authorization Code + PKCE（04-backend-design.md 第 11 节"Google"）。
 *
 * 只用 arctic 拿 token，会话仍然是我们自己的 JWT。对外只暴露两个动作，路由层不直接碰 arctic，
 * 测试时换成假实现，不用真的连 Google。
 */
export interface GoogleOAuth {
  /** 生成 state、PKCE verifier 和授权页地址。state / verifier 由路由写进 httpOnly cookie */
  start(): { state: string; codeVerifier: string; url: URL };
  /** 用回调里的 code 换 token，返回 Google 用户的 sub */
  exchange(code: string, codeVerifier: string): Promise<string>;
}

export function createGoogleOAuth(options: { clientId: string; clientSecret: string; redirectUri: string }): GoogleOAuth {
  const google = new Google(options.clientId, options.clientSecret, options.redirectUri);
  return {
    start() {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      // 只要 openid：我们只需要 sub，不要邮箱、头像等个人信息
      const url = google.createAuthorizationURL(state, codeVerifier, ["openid"]);
      return { state, codeVerifier, url };
    },
    async exchange(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      // sub 从 ID token 里取，不再调 userinfo（设计文档写的是 userinfo，缺口 #37）：
      // ID token 是服务端直接通过 TLS 从 Google token 端点拿到的，OpenID Connect Core 3.1.3.7
      // 允许这种情况下用 TLS 服务端校验代替签名校验。少一次网络请求，sub 完全一样。
      const claims = decodeIdToken(tokens.idToken()) as { sub?: unknown };
      if (typeof claims.sub !== "string" || claims.sub.length === 0) {
        throw new Error("Google ID token 里没有 sub");
      }
      return claims.sub;
    },
  };
}
