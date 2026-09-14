import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

export default Alchemy.Stack(
  "binance-contract-trading-full-stack",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const webWorker = yield* Cloudflare.Website.StaticSite("web", {
      cwd: "../../apps/web",
      command: "pnpm run build:cloudflare",
      // Rebuild shared workspace dependencies until Alchemy has a workspace-aware default memo.
      memo: false,
      outdir: ".open-next/assets",
      main: "../../apps/web/.open-next/worker.js",
      bundle: false,
      compatibility: {
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      env: {
        IMAGES: Cloudflare.Images.Images(),
        NEXT_PUBLIC_SERVER_URL: Config.string("NEXT_PUBLIC_SERVER_URL"),
      },
      dev: {
        command: "pnpm run dev:bare",
        url: "http://localhost:3001",
      },
    });

    return {
      web: webWorker.url,
    };
  }),
);
