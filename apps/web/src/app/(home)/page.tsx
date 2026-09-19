import { FeatureCards } from "./_ui-components/feature-cards";
import { HeroSection } from "./_ui-components/hero-section";
import { HotContracts } from "./_ui-components/hot-contracts/hot-contracts";
import { StatsBar } from "./_ui-components/stats-bar";

/** 首页（Figma 2:2）：介绍 → 数据条 → 热门合约 → 卖点。未登录也能看行情 */
export default function HomePage() {
  return (
    <div className="px-10 pt-8">
      <HeroSection />
      <StatsBar />
      <HotContracts />
      <FeatureCards />
    </div>
  );
}
