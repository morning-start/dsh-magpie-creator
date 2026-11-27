---
name: magpie-plugin-debug
description: 排查 magpie 插件装不上、装上不生效、登录失败、请求 401/403、用量不显示、中间件没反应、页面白屏、路由策略不出现等问题：用沙箱复现、读 magpie 的日志与插件宿主输出、按运行时（Bun 宿主 / moejs / 页面沙盒）逐层定位。用户说「magpie 插件不生效」「magpie 报错」「插件加载失败」「登录不了」「magpie 插件调试」时用。
---

# 调试一个 magpie 插件

magpie 的插件跑在三个完全不同的地方，报错也出现在三个不同的地方。**先确定它在哪一层，再去那一层找证据**，不要凭感觉改代码。

| 层 | 谁在跑 | 证据在哪 |
|---|---|---|
| Bun 插件宿主 | 供应商、工具、异步钩子 | `magpie plugin` 的输出、`plugin: …` 日志行 |
| moejs（magpie 进程内） | 中间件、路由策略、Agent | 设置 → 插件（调用次数、平均耗时、失败次数、最近一次错误）、`plugin: …` 日志 |
| 页面沙盒 | 页面、面板 | 页面位置的「此页面已停止工作」、窗口控制台 |

## 0. 先看环境

```
magpie_doctor
```

- magpie 找不到 → 一切免谈，先让用户装；
- 网关没在跑 → 文件夹插件仍可用命令行测，但页面、工具、真请求都测不了；
- Bun 宿主没下载 → 第一次 `magpie plugin add` 时 magpie 会自己下载，沙箱里也一样（会慢几秒）。

## 1. 静态检查先跑一遍

```
magpie_plugin_check({ dir: '<包目录>', load: true })
```

`load: true` 会真的 import 这个包、用一个替身 client 调用它的插件函数（社区仓库的 `scripts/check.mjs` 就是这么做的），抓出静态读源码看不出来的毛病：`auth` 少了 loader、工具少了 `execute` 或描述、`config` 没给供应商模型、入口 import 就抛错。

它能提前抓到一半的「装不上」：

- `entry` / `exports`：magpie 找不到入口，或入口没有导出插件函数。注意 magpie 把**每个导出的函数**都当插件调用，辅助函数必须放进 `export const _internal = { … }`；
- `hooks`：加载后钩子的形状不对（没有 loader、方法类型不认识、工具没有 `execute`）；
- `*-moejs`：中间件 / 路由 / Agent 里用了 `fetch`、定时器、`process`、`Buffer`、裸包名 import——这些在 moejs 里都没有，magpie 会加载失败或静默不生效；
- `page-bridge` / `page-inline-script` / `page-asset`：页面没引 `_magpie/bridge.js`、有内联脚本、引用了包外文件——页面会白屏或显示「已停止工作」；
- `permission`：页面声明了 magpie 不提供的读取，读取会被拒；
- `agent-mcp-format`：`library.mcp` 没配 `mcpFormat`，插件直接不加载；
- `registry`：包里的 `registry.json` magpie 读不完整（一条类型不对，丢掉全部条目）。

## 2. 在沙箱里复现，不要动用户的 magpie

```
magpie_sandbox({ action: 'create', name: 'debug', plugin: '<包目录>' })
magpie_sandbox({ action: 'install', name: 'debug', plugin: '<包目录>' })
magpie_sandbox({ action: 'list', name: 'debug' })
```

`install` 的输出就是 magpie 加载时的原话：`✓ added …` 后面跟着它认出来的东西。**加载失败会在这里直接说原因**，通常比日志更清楚。

`list` 里看不到你的插件 / 看不到它的钩子和工具，就是没加载成功——回到第 1 步。

## 3. 按症状定位

### 装上但登录不了

- `magpie_sandbox({ action: 'login', name, provider })` 走一遍每种登录方式，看它停在哪一步：
  - 提问没出现 → `prompts` 的条件（`when`）写错了；
  - `authorize` 抛错 → 错误信息会原样给用户看（最多 500 字），先让它说人话；
  - 回调超时 → `callback(code, { signal })` 要处理 `signal`，用户取消后不要再发请求；
  - 登录成功但账号没出现 → 结果里没有 `accountId` / `email`，magpie 没法命名它。
- 登录态保存位置：`<配置目录>/plugin-auth.json`（600）。沙箱里就是沙箱自己的那份。

### 请求 401 / 403 / 一直失败切换

- 401 默认会把账号标记为「需要重新登录」，之后不再往它发请求。如果这个 401 说的其实是「模型不可用」，在 `fetch` 返回的响应上加 `X-Magpie-Sign-In: kept`（magpie 会把这个头去掉再转发）。
- 账号不能用某个模型时，用 403 或 404 加厂商原话，**不要用 401**。
- 想只测某一个账号：`GET /v1/magpie/accounts` 拿到 `pin`，请求时带 `X-Magpie-Account: <pin>`，不走路由、不切换。

### 用量 / 额度不显示

- `auth.usage` 的返回值每个字段都可选；**不知道 `used` 就不要写 0**，写 0 会被当成「用了 0%」。
- 窗口没有 `used` 也没有 `amount`/`limit` 时，路由不会读它。
- `aside: true` 的窗口只展示，不参与路由——别把真正会让账号停下的额度标成 aside。
- 沙箱里验证：`magpie_sandbox({ action: 'run', … })` 不提供任意命令时，用命令行 `magpie quota`（在沙箱环境变量下）。

### 中间件没反应

- 中间件在 moejs 里跑，**一个文件**：相对 import 可以，裸包名不行；没有 `fetch`、没有定时器。
- 钩子抛错、超时（请求 250 ms、事件 50 ms）或返回了别的东西，magpie 当作它不存在，请求原样发出去——所以「没反应」很可能是它一直在失败。设置 → 插件里看失败次数和最近一次错误。
- 流式回复里，一个词可能被拆在两个事件里；`events` 只写你真正要处理的事件名（Chat 和 Gemini 的事件没有名字，别写 `events`）。
- 中间件看不到 magpie 自己的请求（会话标题、路由分类器、代搜），这是设计如此。

### 路由策略不出现

- 文件要导出 `strategies`，包要声明 `magpie.gateway`，或者文件名以 `.gateway.js` 结尾。
- 名字是 `<插件短名>/<策略名>`；插件关掉后，用它的分组会退回列表顺序。
- 策略有 20 ms，返回的必须是座位的**排列**（下标），否则按列表顺序。

### 页面白屏 / 显示「此页面已停止工作」

- 10 秒内没有 `await magpie.ready` 就会被判为没回应。
- 脚本必须是文件；内联 `<script>` 不执行。`connect-src 'none'`：任何 `fetch`、WebSocket、表单、iframe 都不行。
- 页面自己的脚本错误在页面里只显示「Script error.」，真错误在窗口控制台里。
- 读取被拒：`magpie.read` 的名字必须在 `magpie.permissions` 里，而且只能是 `usage:summary`、`providers:list`。

### Agent 插件不出现

- `id` 不能是 magpie 自己的 agent（`claude`、`codex`、`gemini`、`opencode`、`dsh` …）。
- `magpie.agent` 指向的文件要导出 `agent`；`connect` 可选，但只写 model 的话很多 Agent 用不起来。
- `library.mcp` 必须配 `mcpFormat`，否则整个插件不加载。

## 4. 读日志

```sh
magpie log --path          # 日志在哪
magpie log -n 200          # 最近 200 行
```

插件打印的任何东西（`console.log`、`process.stdout`）都会被转到 stderr，magpie 记成 `plugin: …`。沙箱里的日志在沙箱自己的 `$XDG_STATE_HOME` / 配置目录下，不会污染用户的日志。

## 5. 改完怎么让它生效

- 文件夹插件：终端里每条 `magpie` 命令都会重新加载当前内容，**直接再跑一次就行**；
- 应用里：把插件关掉再打开（加、删、更新、开关都会重启宿主）；
- 中间件：magpie 每秒检查文件和 `plugins.json`，改了自动重载；
- 页面：重新打开那一页。

## 6. 报告问题

修不了或像是 magpie 自己的问题时，给用户一份能直接贴进 issue 的东西：magpie 版本（`magpie --version`）、平台、插件包名与版本、`magpie plugin` 里那一行、相关 `plugin: …` 日志、复现步骤。**不要把密钥、cookie、账号邮箱贴进去。**
