---
name: magpie-plugin-gateway
description: 写 magpie 网关插件：中间件（改请求 / 改回复 / 拒绝请求）、路由策略（决定先试哪个账号）、异步请求钩子（请求前等 I/O：召回记忆、采集对话、通知）、用量观察。讲清 moejs 的限制、钩子签名、ctx 里有什么、超时与失败怎么处理。用户说「magpie 中间件」「改 magpie 的请求」「magpie 路由策略」「magpie 钩子」「让 magpie 记住对话」时用。
---

# 网关插件：中间件、路由、异步钩子

三种东西都挂在 magpie 的网关上，但跑在两个不同的地方：

| 形态 | 跑在哪 | 能等 I/O 吗 | 能拒绝请求吗 | 声明 |
|---|---|---|---|---|
| 中间件 | moejs（magpie 进程内） | 不能 | 能（`ctx.reject`） | `magpie.middleware` |
| 路由策略 | moejs | 不能 | 不能 | `magpie.gateway`，导出 `strategies` |
| 异步钩子 | Bun 宿主 | 能 | 不能 | `magpie.hooks` |

先定：**要联网 / 要等 / 要存东西 → 异步钩子；每个请求每个事件都要过一遍 → 中间件。**

## 1. moejs 的硬限制（中间件、路由、Agent）

- **一个文件**：只能相对路径 import 插件里的文件，没有 `node_modules`，用到的依赖要打包进文件；
- 没有定时器、没有 `fetch`、没有 Node API（`process`、`Buffer`、`fs`）；
- 有标准 JavaScript 和 `console.log`（进 magpie 日志，每分钟最多 60 行）；
- 钩子可以是 `async`，但没什么可等；
- 改文件后 magpie 每秒检查一次，自动重载。

`magpie_plugin_check` 会把这些全拦下来。

## 2. 中间件

```js
export const events = ['content_block_delta']   // 只处理这些名字的事件（Chat / Gemini 的事件没有名字，别写）

export function onRequest(body, ctx) {          // 路由之前
  if (ctx.caller?.agent === 'pi') return ctx.reject(403, 'not for Pi')
  body.model = alias(body.model)
  return body
}

export function onEvent(event, ctx) {           // 流式回复的每个事件
  return event                                  // 返回 null 表示丢掉这个事件
}

export function onResponse(body, ctx) {         // 非流式回复，ctx.status 是状态码
  return body
}
```

`ctx` 里有：`protocol`（`anthropic` / `chat` / `responses` / `gemini`）、`model`、`stream`、`path`、`agent`、`caller`（`{agent, name, via}`）、`options`（用户给这个插件设的选项）、`state`（这个请求独有的对象，各钩子共享）。

请求体和事件都是 **agent 自己的 API 形状**，不是供应商的。

**超时与失败**：请求 / 一次供应商尝试 / 整个回复 250 ms，一个事件 50 ms，加载 1 秒。抛错、超时、返回了别的东西 → 当作它不存在，请求原样发出去。所以「没反应」多半是它一直在失败——去设置 → 插件看失败次数和最近一次错误。

**看不到的**：magpie 自己的请求（会话标题、路由分类器、它替 agent 做的网页搜索和图片描述）不经过中间件。

## 3. 路由策略

```js
export const strategies = {
  'most-room': (pool, seats, options) =>
    seats.map((_, i) => i).sort((a, b) => seats[a].used - seats[b].used),
}
```

- 名字是 `<插件短名>/<策略名>`，出现在每个路由选择器里；
- 座位字段：`key`、`account`、`known`、`learns`、`used`、`soon`（窗口何时刷新，毫秒）、`pace`、`weight`、`resting`、`tokens`；
- 有 20 ms，返回的必须是座位的**排列**（下标）；抛错、超时、返回别的 → 按列表顺序；
- 插件关掉后，用它的供应商或分组也按列表顺序。

## 4. 异步请求钩子

```js
export async function onRequest(body, ctx) {
  const memory = await recall(ctx.query, { signal: ctx.signal })
  if (!memory) return
  body.messages.unshift({ role: 'system', content: memory })
  return body
}

export async function onResponse(reply, ctx) { /* 尽力投递，改不了回复 */ }
export async function onSignIn(event) { /* 账号要重新登录，只通知一次，不含 token */ }
```

- 在 Bun 里跑，每个 agent 请求一次，**在 JS 中间件之前**，对所有供应商生效；
- `ctx`：`protocol`、`model`、`stream`、`path`、`agent`、`caller`、`session`、`cwd`、`query`（最后一条用户文本，不含工具结果和图片）、`options`、`signal`；
- 返回对象替换请求，返回 `undefined` 保留原样；**改模型、流式、客户端工具或工具选择会被回滚**，算失败；
- 每个钩子默认 1 秒，`gatewayTimeoutMs` 可设 100–30000；整条链 2–10 秒；
- `ctx.report(code, bytes)` 只接受 `ready` / `empty` / `unbound` / `unauthorized` / `unavailable` / `invalid` / `skipped` 和字节数，不保存私有文本；
- 用 `ctx.signal` 发 fetch。

## 5. 选项

```sh
magpie plugin options <插件短名> '{"ceiling":80}'
magpie plugin options <插件短名> off
```

中间件从 `ctx.options` 读，钩子从 `ctx.options` 读。`package.json` 里的 `magpie.options` 只是编辑器的起点，**没保存之前运行时是空的**。

## 6. 用量观察

同一个模块（或 `*.gateway.js`）可以导出 `onUsage(row, options)`：每个请求结束后拿到 `provider`、`account`、`model`、token、`ms`、`ttftMs`、`status`、错误类型、费用，**没有请求体、提示词或错误文本**。它单独跑，请求从不等它；有 250 ms。

## 7. 测试

```sh
bun test    # 中间件跑 cases.json，路由跑 strategies.json，钩子跑自己的测试
```

模板里的 `cases.json` / `strategies.json` 和社区仓库 `scripts/middleware.mjs` 的格式一致，所以搬进社区仓库后测试不用改：

- `cases.json`：一个列表，每项有 `name`，以及 `request` / `events` / `response` 里至少一个；`expect_request` / `expect_events` / `expect_response` 是期望值，`reject` 期望被拒绝（`{status, message}`）；
- `strategies.json`：一个列表，每项有 `name`、`strategy`、`seats`（座位）、`expect`（期望的座位顺序）；`pool` 和 `options` 可选。

社区仓库的 `scripts/check.mjs` 也能直接跑这两份文件，所以放进那个仓库的包，`bun scripts/check.mjs <name>` 就是一次完整验收。

真请求验证：沙箱里加一个供应商，发一次请求，看 `plugin: …` 日志和设置 → 插件里的调用次数。

## 8. 常见坑

- 在中间件里 `await fetch(...)`：moejs 没有 fetch，检查器会拦；
- 用 `setInterval` 定时上报：moejs 没有定时器，改成异步钩子或供应商插件；
- 中间件里改 `body.model` 想「换供应商」：`onRequest` 改 model 是换路由，`onProvider` 里不能再改路由；
- 一个词被拆在两个事件里：流式改写要处理跨事件的状态（`ctx.state`）；
- 钩子里改 `body.tools`：会被回滚，算失败。
