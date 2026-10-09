---
name: frontend-code-standards-ts
description: 编写、修改或评审前端代码（React + TypeScript）时使用。约束常量与枚举、通用函数抽离、业务注释、函数文档、UI 逻辑与渲染分离（xxx_ui_controller）、DTO/Enum 字段注释等规范。只要生成或改动 .ts/.tsx 文件就必须遵守。
---

# 前端代码规范

## 概述

这套规范要保证：任何人拿到代码，**不问作者也能看懂业务意图**，并且能放心修改。

**核心原则：** 代码里的每个判断、每个状态、每个字段都要写清楚它的业务含义，不能靠读者去猜。

**适用范围：** 新写代码必须全部遵守。修改旧代码时，**改到的函数和组件**必须按规范整改（童子军原则），没改到的部分不用顺手重构。

---

## 一、强制规则（用户定义，优先级最高）

### 1. 禁止用字面量做判断

条件判断、switch、比较运算里不许直接写字符串或数字字面量，要先定义常量或枚举。

```ts
// ❌ 错误
if (order.status === 2) { ... }
if (user.role === 'admin') { ... }
if (list.length > 20) { ... }

// ✅ 正确
if (order.status === OrderStatus.Paid) { ... }
if (user.role === UserRole.Admin) { ... }
if (list.length > MAX_VISIBLE_ITEMS) { ... }
```

- 业务状态、类型、角色 → `enum`（或 `as const` 对象 + 联合类型）
- 阈值、上限、时长 → `UPPER_SNAKE_CASE` 常量，命名里带单位：`DEBOUNCE_MS`、`MAX_FILE_SIZE_MB`
- 例外：`0`、`1`、`-1` 用于数组下标、长度判空、自增时可以直接写（`list.length === 0`）
- 常量放在就近的 `constants.ts`。跨模块使用的放到 `src/constants/`

### 2. 通用函数必须抽离

同一段逻辑出现 **2 次及以上**，或者和业务无关的纯工具逻辑（格式化、校验、转换、计算），必须抽成独立函数。

- 纯工具函数放 `src/utils/<领域>.ts`，比如 `utils/date.ts`、`utils/money.ts`
- 带状态或副作用的复用逻辑 → 自定义 Hook `useXxx`，放 `src/hooks/`
- 只在某个业务模块里复用的 → 放模块内的 `utils.ts` / `hooks.ts`，不要过早提升为全局
- 抽离前先搜一下项目里有没有现成实现，禁止重复造轮子

### 3. UI 代码、状态、ref 必须写业务含义注释

每个 `useState`、`useRef`、`useReducer`、`useContext` 以及关键 JSX 区块，都要注释说明**它在业务上代表什么**，而不是复述它的技术含义。

```tsx
// ❌ 错误：只复述了技术含义
// loading 状态
const [loading, setLoading] = useState(false);

// ✅ 正确：说清楚业务含义
/** 提交订单请求进行中，期间禁用「确认支付」按钮，防止重复下单 */
const [isSubmitting, setIsSubmitting] = useState(false);

/** 商品列表滚动容器，用于切换分类时回到顶部 */
const productListRef = useRef<HTMLDivElement>(null);
```

JSX 区块按业务分区加注释：

```tsx
{/* 订单摘要区：展示商品总价、优惠、实付金额 */}
<OrderSummary ... />
```

### 4. 函数必须有文档注释（JSDoc / TSDoc）

所有导出函数、组件、Hook，以及超过 10 行的内部函数，都要写 TSDoc，至少包括：

| 标签 | 内容 |
|---|---|
| 首行描述 | **意图**：为什么要有这个函数、解决什么业务问题 |
| `@description`（可选） | **能力**：具体能做什么，有哪些边界情况 |
| `@param` | 每个参数的业务含义、取值范围 |
| `@returns` | 返回值的含义 |
| `@throws` | 可能抛出的异常及触发条件 |
| `@example` | 公共工具函数必须提供 |

```ts
/**
 * 计算订单实付金额，用于结算页展示和提交校验。
 *
 * @description 先减满减券，再按折扣券打折，结果最低为 0。金额单位统一为「分」，避免浮点误差。
 * @param totalCents - 商品原价总额（分）
 * @param coupons - 用户选中的优惠券列表，按使用顺序排列
 * @returns 实付金额（分），不小于 0
 * @example
 * calcPayableAmount(10000, [fullReductionCoupon]) // => 8000
 */
export function calcPayableAmount(totalCents: number, coupons: Coupon[]): number { ... }
```

### 5. UI 逻辑与渲染分离：`xxx_ui_controller`

组件里**把交互逻辑和渲染结构拆开**。一组内聚的交互能力（事件处理、派生状态、调用动作）用 `useMemo` 包成一个 controller 对象，命名为 `xxx_ui_controller`。JSX 只负责「读 controller + 渲染」。

```tsx
export function CheckoutPage({ orderId }: CheckoutPageProps) {
  /** 当前选中的支付方式，默认余额支付 */
  const [payMethod, setPayMethod] = useState<PayMethod>(PayMethod.Balance);
  /** 支付请求进行中，期间锁定支付按钮 */
  const [isPaying, setIsPaying] = useState(false);

  /**
   * 支付区交互控制器：负责支付方式切换、支付按钮是否可用、发起支付。
   */
  const payment_ui_controller = useMemo(() => ({
    /** 支付按钮是否可点击 */
    canPay: !isPaying && payMethod !== PayMethod.None,
    /** 切换支付方式 */
    selectMethod: (method: PayMethod) => setPayMethod(method),
    /** 发起支付，失败时 toast 提示并解锁按钮 */
    submit: async () => {
      setIsPaying(true);
      try {
        await payOrder(orderId, payMethod);
      } finally {
        setIsPaying(false);
      }
    },
  }), [isPaying, payMethod, orderId]);

  // ---------- 渲染区：不写业务逻辑 ----------
  return (
    <>
      {/* 支付方式选择区 */}
      <PayMethodPicker value={payMethod} onChange={payment_ui_controller.selectMethod} />
      {/* 支付操作区 */}
      <Button disabled={!payment_ui_controller.canPay} onClick={payment_ui_controller.submit}>
        确认支付
      </Button>
    </>
  );
}
```

规则：
- 一个 controller 只负责**一个交互区域**（支付区、筛选区、弹窗区……），不要做成大而全的 God Object
- controller 内每个字段都要写注释
- `useMemo` 依赖数组必须完整，禁止用 `eslint-disable` 绕过 `react-hooks/exhaustive-deps`
- JSX 里禁止出现多行内联箭头函数、三元嵌套、复杂计算，统一挪进 controller
- controller 超过约 80 行，或者被多个组件复用时，要抽成自定义 Hook：`usePaymentUiController()`

### 6. DTO 和 Enum 的每个字段都要有注释

```ts
/** 订单详情接口返回结构（GET /api/orders/:id） */
export interface OrderDetailDTO {
  /** 订单唯一 ID */
  id: string;
  /** 订单状态，见 OrderStatus */
  status: OrderStatus;
  /** 实付金额，单位：分 */
  payableCents: number;
  /** 下单时间，ISO 8601 字符串 */
  createdAt: string;
  /** 买家备注，用户未填写时为 null */
  remark: string | null;
}

/** 订单状态（与后端 order_status 字段保持一致） */
export enum OrderStatus {
  /** 待支付：已下单未付款，30 分钟后自动关闭 */
  Pending = 1,
  /** 已支付：等待商家发货 */
  Paid = 2,
  /** 已关闭：超时未付或用户取消 */
  Closed = 3,
}
```

- 注释写清**单位、格式、可空的含义、取值来源**
- Enum 要注明是否和后端对齐、对齐的字段名
- 禁止用 `any`。确实不确定的类型用 `unknown` 再收窄

### 7. 复杂判断改用选择模式

判断逻辑复杂时，不要写长串 if/else 或 switch。把「条件 → 结果/行为」声明成数据结构，由代码**选出**要执行的分支，不要让代码一层层**走到**那个分支。

**满足下面任意一条就必须改用选择模式：**
- 对同一个维度（状态、类型、角色……）判断 **3 个及以上分支**
- 一个条件里组合了 **2 个及以上维度**（比如「状态 + 角色 + 是否过期」）
- 不同分支执行的是**不同的行为**，而不只是返回不同的值
- 同一组分支判断在 **2 处及以上**重复出现

只有 1~2 个简单分支时，继续用 if 或早返回就行，不要为了用模式而用模式。

#### 7.1 映射表：按条件选值或配置

```ts
// ❌ 错误
function getStatusLabel(status: OrderStatus) {
  if (status === OrderStatus.Pending) return '待支付';
  else if (status === OrderStatus.Paid) return '已支付';
  else if (status === OrderStatus.Closed) return '已关闭';
}

// ✅ 正确
/** 订单状态 → 展示配置 */
const ORDER_STATUS_VIEW: Record<OrderStatus, StatusView> = {
  /** 待支付：橙色，提醒用户尽快付款 */
  [OrderStatus.Pending]: { label: '待支付', color: 'orange' },
  /** 已支付：绿色 */
  [OrderStatus.Paid]: { label: '已支付', color: 'green' },
  /** 已关闭：灰色，弱化展示 */
  [OrderStatus.Closed]: { label: '已关闭', color: 'gray' },
};
const view = ORDER_STATUS_VIEW[order.status];
```

#### 7.2 策略表：按条件选行为

每个分支的行为不同时，把每种行为写成**签名一致的策略函数**，再用枚举选出要执行的那个。

```ts
/** 支付策略统一签名：发起支付，返回支付结果 */
type PayStrategy = (orderId: string, amountCents: number) => Promise<PayResult>;

/** 支付方式 → 支付实现 */
const PAY_STRATEGIES: Record<PayMethod, PayStrategy> = {
  /** 余额支付：直接扣减账户余额 */
  [PayMethod.Balance]: payByBalance,
  /** 微信支付：拉起微信收银台 */
  [PayMethod.WeChat]: payByWeChat,
  /** 支付宝：跳转支付宝 H5 */
  [PayMethod.Alipay]: payByAlipay,
};

await PAY_STRATEGIES[payMethod](orderId, amountCents);
```

以后新增一种支付方式 = 新增一个枚举值 + 一个策略函数，不用改调用方。

#### 7.3 规则链：多维度组合条件，按优先级选

条件由多个维度组合、而且有先后优先级时，写成**有序规则数组**，按顺序取第一个命中的。

```ts
// ❌ 错误：条件交织、优先级靠嵌套顺序隐式表达
let btn;
if (user.role === UserRole.Guest) btn = { text: '登录后购买', disabled: false };
else if (product.stock === 0) btn = { text: '已售罄', disabled: true };
else if (product.isPresale && !product.presaleStarted) btn = { text: '即将开售', disabled: true };
else btn = { text: '立即购买', disabled: false };

// ✅ 正确
/** 购买按钮状态规则，按数组顺序匹配，靠前的优先级更高 */
const BUY_BUTTON_RULES: Array<Rule<BuyContext, BuyButtonView>> = [
  {
    /** 未登录用户优先引导登录，不管库存如何 */
    match: (ctx) => ctx.user.role === UserRole.Guest,
    result: { text: '登录后购买', disabled: false },
  },
  {
    /** 库存为 0 时禁止购买 */
    match: (ctx) => ctx.product.stock === OUT_OF_STOCK,
    result: { text: '已售罄', disabled: true },
  },
  {
    /** 预售商品还没到开售时间 */
    match: (ctx) => ctx.product.isPresale && !ctx.product.presaleStarted,
    result: { text: '即将开售', disabled: true },
  },
];

/** 兜底：上面的规则都没命中时，正常可购买 */
const DEFAULT_BUY_BUTTON: BuyButtonView = { text: '立即购买', disabled: false };

const btn = BUY_BUTTON_RULES.find((rule) => rule.match(ctx))?.result ?? DEFAULT_BUY_BUTTON;
```

通用的规则类型和匹配函数放在 `src/utils/rule.ts`，全项目复用（对应规则 2）：

```ts
/** 一条选择规则：条件命中时返回对应结果 */
export interface Rule<Ctx, R> {
  /** 匹配条件，返回 true 表示命中 */
  match: (ctx: Ctx) => boolean;
  /** 命中后返回的结果 */
  result: R;
}

/**
 * 按顺序匹配规则链，返回第一个命中规则的结果。
 * @param rules - 有序规则列表，越靠前优先级越高
 * @param ctx - 匹配上下文
 * @param fallback - 全部没命中时的兜底结果
 */
export function selectByRules<Ctx, R>(rules: Rule<Ctx, R>[], ctx: Ctx, fallback: R): R {
  return rules.find((rule) => rule.match(ctx))?.result ?? fallback;
}
```

#### 7.4 组件选择：按条件选渲染哪个组件

```tsx
// ❌ 错误
{msg.type === MessageType.Text ? <TextCard /> : msg.type === MessageType.Image ? <ImageCard /> : <FileCard />}

// ✅ 正确
/** 消息类型 → 对应的卡片组件 */
const MESSAGE_CARD: Record<MessageType, ComponentType<MessageCardProps>> = {
  /** 纯文本消息 */
  [MessageType.Text]: TextCard,
  /** 图片消息，支持点击预览 */
  [MessageType.Image]: ImageCard,
  /** 文件消息，展示文件名和下载入口 */
  [MessageType.File]: FileCard,
};

const Card = MESSAGE_CARD[msg.type];
return <Card message={msg} />;
```

#### 选择模式的约束

- **用 `Record<Enum, X>` 保证穷举**：新增枚举值却忘了补映射时，编译会报错。禁止用 `Record<string, X>` 或普通对象字面量绕过这层检查
- **必须有明确的兜底**：规则链要有 `DEFAULT_XXX`，外部输入（比如后端返回的未知枚举值）查表时要处理 `undefined`
- **每个映射项、策略、规则都要写业务注释**（对应规则 3 / 6）
- **规则链的顺序就是优先级**，要在数组上方注释写明
- **表的定义位置**：不依赖组件状态的表放在**模块顶层常量**里，不要在组件内部定义，避免每次渲染都重新创建；依赖状态的放进 `xxx_ui_controller`
- 实在要用 switch 时，`default` 分支必须调用 `assertNever(value)` 做穷举检查：

```ts
/** 穷举检查：新增枚举值却漏了处理时，编译期就会报错 */
export function assertNever(value: never): never {
  throw new Error(`未处理的分支: ${String(value)}`);
}
```

---

## 二、补充规则

### 7. 命名规范

| 对象 | 规则 | 示例 |
|---|---|---|
| 组件 / 类型 / 接口 / 枚举 | PascalCase | `OrderCard`、`OrderDetailDTO` |
| 变量 / 函数 | camelCase | `fetchOrderList` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| UI 控制器 | snake_case + `_ui_controller` | `filter_ui_controller` |
| 布尔值 | `is/has/can/should` 前缀 | `isVisible`、`hasPermission` |
| 事件处理（内部） | `handle` 前缀 | `handleSubmit` |
| 事件回调（props） | `on` 前缀 | `onSubmit` |
| 自定义 Hook | `use` 前缀 | `useOrderList` |
| 组件文件 | PascalCase.tsx | `OrderCard.tsx` |
| 非组件文件 | camelCase.ts | `orderUtils.ts` |

禁止使用 `data`、`info`、`temp`、`flag`、`obj` 这类没有业务含义的名字。

### 8. 组件规模与职责

- 单个组件文件**不超过 300 行**，单个函数**不超过 50 行**。超出就拆分
- JSX 嵌套**不超过 4 层**，更深的抽成子组件
- 一个组件只做一件事：容器组件负责取数和编排，展示组件只接收 props 做渲染
- Props 超过 7 个时考虑合并成对象，或者重新审视职责划分

### 9. 控制流

- 优先用**早返回（guard clause）**，代码嵌套不超过 3 层
- 禁止嵌套三元表达式
- 多分支映射优先用「枚举 → 配置对象」查表，不用长串 if/else：

```ts
/** 订单状态对应的展示文案与颜色 */
const ORDER_STATUS_VIEW: Record<OrderStatus, { label: string; color: string }> = {
  [OrderStatus.Pending]: { label: '待支付', color: 'orange' },
  [OrderStatus.Paid]: { label: '已支付', color: 'green' },
  [OrderStatus.Closed]: { label: '已关闭', color: 'gray' },
};
```

### 10. Hooks 使用

- `useEffect` 只用来**同步外部系统**（订阅、DOM、定时器），不要拿来算派生状态。派生值直接算，或者用 `useMemo`
- 每个 `useEffect` 上方注释：**什么时候触发、做什么、怎么清理**
- 有订阅或定时器的 effect 必须返回清理函数
- 异步 effect 要处理竞态（`AbortController` 或忽略过期响应）
- 能从已有 state/props 算出来的值，禁止再存一份 state

### 11. 类型安全

- 开启 `strict: true`
- 禁止 `any`、`@ts-ignore`。确实需要时用 `@ts-expect-error` 并写明原因
- 禁止非空断言 `!`，除非注释说明为什么一定非空
- 接口返回数据在边界处做校验或转换（DTO → 前端 Model），不要让后端结构直接渗透进 UI

### 12. 接口与数据层

- 所有请求统一放在 `src/services/` 或 `src/api/`，组件里禁止直接写 `fetch`/`axios`
- 每个接口函数都写 TSDoc，注明接口路径和用途
- DTO（后端结构）和 View Model（前端展示结构）分开定义，转换函数命名为 `toXxxViewModel`

### 13. 错误处理

- 异步操作必须处理失败分支：给用户提示，并恢复 UI 状态（比如解锁按钮）
- 禁止空的 `catch {}`，至少记录日志并写明为什么可以忽略
- 页面级组件要有 ErrorBoundary 兜底
- 用户可见的错误文案要友好，不要直接展示后端原始报错或堆栈

### 14. 样式

- 禁止在样式里写魔法数值，颜色、间距、字号用设计 token 或主题变量
- 除动态计算值外，禁止写内联 `style`
- 遵循项目既有方案（CSS Modules / Tailwind / styled），不要混用

### 15. 性能

- 列表渲染的 `key` 必须用稳定的业务 ID，禁止用 index（静态、不会重排的列表除外）
- 传给 `memo` 子组件的回调和对象，用 `useCallback`/`useMemo` 保持引用稳定
- 不要为了「优化」到处包 `useMemo`：简单计算直接算，controller 和昂贵计算才包
- 长列表（>100 条）用虚拟滚动
- 路由级组件做懒加载

### 16. 安全

- 禁止用 `dangerouslySetInnerHTML`。确实需要时必须先用 DOMPurify 等库清洗，并写注释说明
- 禁止把 token、密钥硬编码进代码
- URL 参数、用户输入在拼接或渲染前必须校验或转义

### 17. 可访问性（a11y）

- 能点击的元素用 `<button>`/`<a>`，禁止给 `div` 绑 `onClick`
- 图片必须有 `alt`，图标按钮必须有 `aria-label`
- 表单控件要关联 `<label>`

### 18. 导入与目录

- 导入顺序：第三方库 → 项目别名路径（`@/`）→ 相对路径 → 样式。组与组之间空一行
- 禁止循环依赖
- 禁止深层相对路径（`../../../`），改用别名

### 19. 注释的原则

- 注释说明**为什么**和**业务含义**，不要复述代码字面意思
- 临时方案写 `// TODO(姓名): 原因 + 期望的最终方案`
- 删掉被注释掉的死代码，版本历史交给 git

### 20. 日志与调试

- 提交代码中禁止保留 `console.log`、`debugger`
- 需要保留的日志走统一的 logger，并区分级别

---

## 三、提交前自查清单

- [ ] 判断语句里没有裸字面量，都用了常量或枚举
- [ ] 没有重复逻辑，通用函数已抽到 utils/hooks
- [ ] 每个 state / ref / context 都有业务含义注释
- [ ] 导出函数、组件、Hook 都有完整 TSDoc（意图 / 参数 / 返回值）
- [ ] 交互逻辑已收进 `xxx_ui_controller`，JSX 里没有业务逻辑
- [ ] DTO / Enum 每个字段都有注释（单位 / 格式 / 可空含义）
- [ ] 没有 `any`、`@ts-ignore`、`console.log`
- [ ] `useEffect` 有注释、依赖完整、有清理函数
- [ ] 异步操作处理了失败分支和 UI 状态恢复
- [ ] 组件 ≤ 300 行，函数 ≤ 50 行，嵌套 ≤ 3 层
- [ ] 列表 key 用的是稳定业务 ID

## 四、常见借口与回应

| 借口 | 回应 |
|---|---|
| 「这个字面量就用一次，不用定义常量」 | 就算只用一次，读者也看不出 `status === 2` 是什么意思。必须定义 |
| 「变量名已经说明了，不用写注释」 | 名字说明的是技术含义，注释要写业务含义（为什么、什么时候、有什么约束） |
| 「这个组件很小，不用拆 controller」 | 只有 1~2 个简单 handler 时可以不拆；有 3 个以上交互动作或派生状态就要拆 |
| 「先写完功能，注释以后补」 | 以后不会补。注释和代码一起提交 |
| 「后端字段是自解释的」 | 单位、可空含义、枚举取值，后端字段名体现不出来 |