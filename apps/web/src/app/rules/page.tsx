import type { Metadata } from "next";
import Link from "next/link";

import { INITIAL_BALANCE_DISPLAY, RESET_COOLDOWN_HOURS } from "@/lib/config/constants";
import { RULE_ANCHORS } from "@/lib/config/rule-anchors";

import { RULE_SECTIONS } from "./_lib/sections";
import { Differences } from "./_ui-components/differences";
import { FeeRates } from "./_ui-components/fee-rates";
import { Bullets, Callout, H2, H3, P, Term } from "./_ui-components/prose";
import { TableOfContents } from "./_ui-components/table-of-contents";

export const metadata: Metadata = {
  title: "模拟规则",
  description: "这个模拟盘和真实交易所有哪些不同，撮合、排队、强平、资金费和账户重置分别怎么算",
};

/**
 * R 模拟规则（05 第 1 节 / M12）：长文页面，左目录右正文，不需要登录。
 *
 * 内容按设计文档写，**不按 Figma 稿的文案**（稿子里有几条和实际逻辑不符：
 * 强平说成按标记价市价平、市价单没提吃穿深度拒单、重置没提冷却和排行榜影响，
 * 还缺失真点那一节。用户 2026-09-19 定：只用稿子的样式）。
 *
 * 整页服务端渲染，只有费率那一小块是客户端组件——那几个数要从服务端现取，不写死。
 */
export default function RulesPage() {
  const [differences, matching, margin, account] = RULE_SECTIONS;

  return (
    <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-10 px-6 py-8 lg:grid-cols-[200px_1fr]">
      <aside className="hidden lg:block">
        <TableOfContents />
      </aside>

      <article className="flex min-w-0 flex-col gap-10">
        <header className="flex flex-col gap-3">
          <h1 className="font-bold text-[26px] text-foreground">模拟规则</h1>
          <P>
            这是一个用币安真实行情驱动的模拟盘：行情是真的，账户、撮合、风控、强平全部由我们自己实现，
            <Term>不会产生任何真实下单</Term>，USDT 由本地服务发放。
          </P>
          <Callout>
            这一页的原则是一句话：<Term>宁可说做不到，不要编数字。</Term>
            凡是我们拿不到真实数据的地方，宁可拒单、暂停撮合、显示「--」，也不给你一个看起来合理、实际是编的数。
          </Callout>
        </header>

        {/* ——— R-02 和真实交易所的差别 ——— */}
        <section className="flex flex-col gap-4">
          <H2 id={differences.id}>{differences.title}</H2>
          <P>
            下面 9 条是<Term>明确知道并选择接受</Term>的差距。每一条都对应一个「本可以造假但选择不造」的决定。
          </P>
          <Differences />
          <P>
            还有一条曾经被记为差别的：跨层杠杆超限时我们直接拒单。后来和币安核对过， 币安也是拒单（错误码 -2027），所以
            <Term>这条不算差别</Term>。
          </P>
        </section>

        {/* ——— R-03 撮合与排队 ——— */}
        <section className="flex flex-col gap-4">
          <H2 id={matching.id}>{matching.title}</H2>
          <P>
            你的单不会发到币安。它们进的是我们自己的挂单簿，靠两股真实数据来推动：
            <Term>币安的盘口快照</Term>（你看到的深度）和<Term>币安的逐笔成交</Term>（谁在什么价位成交了多少）。
          </P>
          <Bullets
            items={[
              <>
                <Term>市价单</Term>：按当前盘口<Term>逐档吃</Term>，成交均价就是逐档加权的结果。这就是你看到的滑点。
              </>,
              <>
                <Term>限价单</Term>：价格比对手价更优、吃不到的部分挂进队列当挂单方（Maker）；
                价格已经穿透盘口的部分立刻成交，按吃单方（Taker）收费。
              </>,
              <>
                <Term>条件单</Term>（止盈止损）：入簿时<Term>不冻结保证金</Term>，触发那一刻才转成市价单或限价单，
                重新走一遍完整的下单校验——所以触发时也可能被拒（比如那时候余额不够了）。
              </>,
              <>
                模拟用户的挂单<Term>互相不撮合</Term>。你的挂单要成交，得等币安那边在你的价位上真的成交了足够的量。
              </>,
            ]}
          />

          <H3 id={RULE_ANCHORS.depth}>盘口深度与市价单拒单</H3>
          <P>
            我们从币安拿到的深度最多 1,000 档，这已经是公开数据的全部。界面上的盘口按你选的精度合并之后每侧显示 20 行，
            但撮合用的是完整的那 1,000 档。
          </P>
          <Callout tone="down">
            一笔市价单如果要吃掉<Term>超过一半的可见深度</Term>，会被直接拒单。
            因为再往下的价格我们不知道——真实交易所那里还有深度，我们这里没有。
            按「最后一档再加点滑点」硬成交，等于编一个数给你。
          </Callout>

          <H3 id={RULE_ANCHORS.queue}>前方排队是怎么估的</H3>
          <P>
            委托列表里有一列叫<Term>前方排队</Term>：在你这个价位上，排在你前面还有多少量没成交。
            币安不公开队列内部顺序，这个数是推出来的，分三步：
          </P>
          <Bullets
            items={[
              <>
                <Term>下单时估一个上限</Term>：你挂进去的那一刻，这个价位上已有的挂单量就是排在你前面的量。
                如果这个价位超出了可见范围，只能估——这时候界面上会显示 <Term>≈</Term>。
              </>,
              <>
                <Term>盘口更新时夹逼</Term>：下一张快照里这个价位总量变小了，说明前面的人要么成交要么撤了，
                前方排队量跟着往下压。估算过的单一旦进入可见范围，直接换成真实值。
              </>,
              <>
                <Term>成交发生时消耗</Term>：币安在这个价位每成交一笔，就从你前方的量里扣掉。 扣到 0
                之后，再成交的量才轮到你，按<Term>你的挂单价</Term>成交。
              </>,
            ]}
          />
          <P>
            所以会出现这种情况：<Term>最新价已经碰到你的挂单价了，单子却还没成交</Term>。
            这是对的——价格碰到只说明有人在那个价位成交，不等于排在你前面的量已经被吃完。真实交易所也是这样。
          </P>
        </section>

        {/* ——— R-04 保证金、强平与资金费 ——— */}
        <section className="flex flex-col gap-4">
          <H2 id={margin.id}>{margin.title}</H2>
          <P>
            公式和币安一致，唯一的区别是上面列出来的那几条。
            <Term>所有依赖账户全局状态的数（强平价、保证金率、 可用余额、未实现盈亏）都由服务端算</Term>
            ，界面只负责显示，不自己算一份。
          </P>
          <FeeRates />
          <Bullets
            items={[
              <>
                <Term>起始保证金</Term> = 名义价值 ÷ 杠杆。名义价值按标记价算，不按最新成交价。
              </>,
              <>
                <Term>维持保证金</Term>按<Term>杠杆分层表</Term>算：仓位越大，要求的维持保证金比例越高，
                能用的最高杠杆也越低。这张表每天从币安官方接口同步。
              </>,
              <>
                <Term>保证金率</Term> = 维持保证金 ÷ 保证金余额。这个数<Term>达到 100% 就触发强平</Term>，
                所以账户面板上它越高越危险。
              </>,
              <>
                <Term>全仓</Term>用整个账户的钱扛所有仓位，一个仓位亏损会拉低全部仓位的安全垫；
                <Term>逐仓</Term>每个仓位单独一份保证金，爆了只亏那一份。
              </>,
            ]}
          />

          <H3 id={RULE_ANCHORS.liquidation}>强平</H3>
          <P>
            触发条件是<Term>权益跌到维持保证金以下</Term>（恰好相等也触发）。逐仓逐个仓位判，全仓按整个账户判。
            触发之后的执行顺序：
          </P>
          <Bullets
            items={[
              <>先撤掉这个币对上的挂单，把冻结的保证金释放出来</>,
              <>
                下一张<Term>强平单</Term>，按当前盘口逐档吃。<Term>比破产价还差的档位不吃</Term>
                ——吃了就要亏到别人头上
              </>,
              <>
                吃不完的部分，按<Term>破产价</Term>平掉（破产价就是「这个仓位的保证金刚好亏光」的那个价）
              </>,
              <>
                依次扣：已实现盈亏 → 吃单手续费 → 清算费。<Term>每一项最多扣到剩余资产为 0</Term>，不会把余额扣成负数
              </>,
            ]}
          />
          <P>
            两点和真实交易所不同：我们<Term>不做部分强平</Term>（触发就平掉整个仓位）；
            也没有保险基金和自动减仓，所以吃不完的部分直接按破产价接管。
          </P>
          <P>
            仓位表里的<Term>强平价</Term>有时候会显示 <Term>--</Term>，背后有三种互不相同的原因：
          </P>
          <Bullets
            items={[
              <>
                <Term>保证金相对仓位过于充足</Term>：算出来的强平价是负数或者根本不在合法价格区间内， 说明当前价格走到 0
                也碰不到强平线。
              </>,
              <>
                <Term>双向持仓下的对冲</Term>：这个币对的多空仓位数量接近对冲，理论上不会被强平，
                暂时算不出一个具体价格。
              </>,
              <>
                <Term>全仓行情未到齐</Term>：账户里还有别的币对没收到标记价，算不出全仓强平价。
              </>,
            ]}
          />
          <P>三种情况都是"暂时算不出来"，不是页面故障，我们不会拿一个凑出来的数字顶上。</P>

          <H3 id={RULE_ANCHORS.funding}>资金费</H3>
          <P>
            永续合约靠资金费把合约价格拉回现货附近：费率为正时<Term>多头付给空头</Term>，为负时反过来。
            费率用的是币安的真实费率，我们不自己算。
          </P>
          <Bullets
            items={[
              <>
                结算时间<Term>跟着币安走</Term>：币安的标记价推送里带着下一次结算时间，到点就结算，
                币安调整结算间隔（默认 8 小时，按币对设置）我们自动跟上。
              </>,
              <>
                金额 = 仓位名义价值 × 费率，名义价值<Term>按标记价</Term>算。逐仓仓位从这个仓位的保证金里付。
              </>,
              <>
                行情断过线、拿不准结算那一刻的费率和标记价时，<Term>这一期不结算</Term>，也不事后补——同样是不编数字。
              </>,
              <>结算完会立刻扫一遍风控：资金费付出去之后保证金不够了，会当场触发强平。</>,
            ]}
          />
        </section>

        {/* ——— R-05 账户与重置 ——— */}
        <section className="flex flex-col gap-4">
          <H2 id={account.id}>{account.title}</H2>
          <Bullets
            items={[
              <>
                开户发 <Term>{INITIAL_BALANCE_DISPLAY} USDT</Term> 模拟资金，同时记一笔「开户赠送」流水。
              </>,
              <>
                账户的铁律是<Term>余额等于全部流水之和</Term>。每一次余额变动——盈亏、手续费、资金费、强平、
                逐仓划转——都有一条流水，在
                <Link href="/orders" className="text-brand hover:opacity-80">
                  历史记录
                </Link>
                里能从上往下一路对到当前余额。
              </>,
            ]}
          />

          <H3 id={RULE_ANCHORS.reset}>重置模拟账户</H3>
          <P>
            重置<Term>不是直接把余额改回去</Term>。为了守住上面那条铁律，服务端走的是正常流程： 撤掉全部挂单 →
            按标记价平掉全部仓位 → 再补一笔「账户重置」流水把余额调回初始值。
            所以重置之后，历史记录里那一串平仓成交是真实存在的。
          </P>
          <Bullets
            items={[
              <>
                <Term>{RESET_COOLDOWN_HOURS} 小时只能重置一次</Term>。冷却中时按钮不可点，界面会显示什么时候能再来。
              </>,
              <>
                <Term>重置会影响排行榜</Term>：统计周期内重置过的账户，不进当期的日榜和周榜
                （否则亏完就重置，收益率可以刷）。
              </>,
              <>
                排行榜的收益率以<Term>期初权益</Term>为分母，胜率按<Term>平仓成交</Term>算，
                当期有成交才上榜。权益快照每天 UTC 00:00 拍一次，错过的那天不补。
              </>,
            ]}
          />
        </section>
      </article>
    </div>
  );
}
