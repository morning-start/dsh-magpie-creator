---
name: magpie-plugin-provider
description: 写 magpie 供应商插件（OpenCode 的 auth 插件）：登录方式（API key / 浏览器 OAuth / 设备码 / 多账号）、loader 与 fetch 签名、provider.models 实时模型、auth.usage 额度、auth.refresh 续期、auth.checkin 签到、X-Magpie-Sign-In 登录状态、模型负载。用户说「给 magpie 加一个供应商 / 订阅」「接一个 magpie 还没登录的厂商」「magpie 插件登录」「magpie 额度不显示」时用。
---

# 供应商插件

一个供应商插件登录某个服务，替它发请求。magpie 把它变成一个供应商：所有 agent 都能用，多账号、故障切换、用量、额度都在。

它跑在 **Bun 插件宿主**里：可以用 `fetch`、`crypto`、`fs`、`$`，可以装 npm 依赖（但安装脚本不会运行）。

## 1. 骨架

```
magpie_plugin_new({ kind: 'provider', packageName: '@acme/opencode-acme-auth', title: 'Acme', id: 'acme', baseUrl: 'https://api.acme.example/v1' })
```

生成的文件：`package.json`、`index.mjs`（config / auth / provider 三个钩子）、`index.test.mjs`、`README.md`。

## 2. 入口的规矩

- magpie 把**入口模块导出的每个函数**都当插件调用：辅助函数放进 `export const _internal = { … }`；
- 也可以 `export default { id, server }`（OpenCode v1 形式）；
- 一个模块导出多个插件函数 = 一个包提供多个供应商；
- 入口查找顺序：`exports["./server"]` → `main` → `exports["."]` → `index.ts/tsx/js/mjs/cjs`。

## 3. 钩子一览

| 钩子 | 什么时候调 | 返回什么 |
|---|---|---|
| `config(cfg)` | 加载时 | 往 `cfg.provider[id]` 写供应商和默认模型（用 `??=`，别覆盖用户配置） |
| `auth.methods` | 登录时 | 每种登录方式：`{ type: 'api' }` 或 `{ type: 'oauth', authorize, callback }` |
| `auth.loader(getAuth)` | 每个账号一次，登录变化后重跑 | `{ baseURL, apiKey, headers, fetch }` |
| `provider.models(provider, { auth })` | 每个账号一次 | 这个账号有的模型 |
| `auth.usage(getAuth)` | 看额度时 | 套餐、窗口、余额 |
| `auth.refresh(auth)` | token 快过期时（同一时间只续一次） | 新的 token 字段 |
| `auth.checkin(getAuth)` | 每个北京日一次 | 签到结果 |
| `chat.headers(input, output)` | 每个请求 | 加头（会话 id、缓存头） |
| `input.magpie.load(provider, loads)` | 插件自己决定 | 报告模型负载 |

## 4. 供应商 id

- 用 `auth.provider` 作为 id，agent 用 `<id>/<model>` 指代；
- id 已被内置订阅、预设（`google`、`openai`、`anthropic`）或 `magpie` 占用时，会变成 `<id>-plugin`——**选一个只属于你的 id**；
- 两个插件登录同一个 id 时，只有其中一个提供，另一行可以点「用于 …」。

## 5. 登录

**API key**：`{ type: 'api', label, placeholder }`，不带 `authorize` 就原样保存成 `{type:'api', key}`。带 `authorize(inputs)` 时自己校验 / 换取，返回 `{type:'success', key}` 或 `{type:'failed', error}`。

**浏览器 / 设备码**：

```js
{ type: 'oauth', label: 'Sign in with Acme', async authorize(inputs) {
  const d = await startDeviceCode()
  return {
    url: d.verification_uri, instructions: `Enter ${d.user_code}`, method: 'auto',
    async callback(code, { signal }) {
      const t = await pollForToken(d, signal)
      return { type: 'success', refresh: t.refresh_token, access: t.access_token, expires: Date.now() + t.expires_in * 1000, accountId: t.email }
    },
  }
} }
```

- `method: 'code'` 时 `callback(code)` 拿到用户粘贴的码；
- 成功结果里带 `refresh` 存成 OAuth 登录，带 `key` 存成 API key；
- 结果里写 `provider: 'other-id'` 可以把登录存到另一个供应商下；
- 失败时 `error` 会原样给用户看（最多 500 字），写人话；
- 用户取消或超时后，`callback` 返回什么都会被丢掉——用 `signal` 停下来。

**提问**：`prompts: [{ type: 'text' | 'select' | 'password', key, message, options, when, validate }]`，`password` 是 magpie 自己的类型（输入不回显）。

**账号**：第一个账号存在供应商 id 下，其他的存在 `id#xxxxxx`。magpie 依次用 `accountId`、`metadata.email`、`email` 给账号命名——**至少存一个**。同名 `accountId`（且 `uid` 相同）会替换旧账号。

**作用域**：`getAuth()` 返回的是当前账号；`client.auth.set({ path: { id }, body })` 写当前账号。**每个账号的状态按拿到的 auth 存，不要放进以供应商为键的模块变量。**

## 6. 请求

`loader` 返回的 `fetch(input, init)` 收到的是**已经翻译成该 API 形状**的请求：

- `input` 是完整 URL（base + 该 API 的路径）；
- `init.body` 是 JSON 字符串（不是 UTF-8 文本时是字节），`model` 已经是 API id；
- 头按顺序覆盖：`apiKey` 的头 → loader 的 `headers` → 网关的头 → `chat.headers`；
- `init.signal` 在 agent 放弃时中止。

返回一个 `Response`，状态、头、正文原样流回去。**改写了流式正文，就要去掉 `content-length` 和 `content-encoding`。**

`npm` 决定 API：`@ai-sdk/anthropic` → Messages `/messages`；`@ai-sdk/openai` / `azure` → Responses `/responses`；`@ai-sdk/google` → Gemini；其他 → Chat completions `/chat/completions`。

base 的选择顺序：loader 的 `baseURL` → 模型的 `provider.api` → 供应商的 `api` → SDK 默认。

## 7. 模型

- `config` 里给默认模型；`provider.models` 按账号给真实列表；
- 模型是 OpenCode 的 Model：`id`、`name`、`limit: {context, output}`、`capabilities`、`cost`、`variants`（推理档位）、`status`；
- magpie 额外读：`free: true`（套餐免费，只有这个字段算免费）、`rate`（点数倍率，`0` 视为没给）、`rateWas`、`serviceTiers`；
- 拉不到时三种做法都算「保留原列表」：原样返回 `provider.models`、抛错、返回自己的列表并设 `list[Symbol.for('magpie.fellBack')] = true`；
- 登录失效时抛 `Object.assign(new Error('…'), { signIn: 'expired' })`。

## 8. 额度（`auth.usage`）

每个字段都可选：`plan`、`user`、`until`、`renew`、`balance`、`error`、`windows[]`、`resets`、`signIn`。

窗口里：`name`、`used`（百分比）、`resetsAt` / `resetSecs`、`span`、`display`、`amount`/`limit`/`unit`、`model`/`models`/`notModels`、`family`/`pool`、`aside`、`runsOutAt`/`runsOut`、`balance`。

- **不知道 `used` 就不要写 0**，写 0 等于「用了 0%」；
- 有 `amount` + `limit` 时份额由它们算；
- 只有 `display` 的窗口不参与路由；
- `aside: true` 只展示不参与路由——真正会让账号停下的额度不要标 aside。

## 9. 登录状态

默认 401 标记账号、成功清除。插件可以在响应上加 `X-Magpie-Sign-In`（magpie 会去掉再转发）：

| 值 | 含义 |
|---|---|
| `expired` | 登录被拒（不管状态码，有些厂商用 403 / 502） |
| `kept` | 账号保持原样（这个 401 说的是别的事） |
| `renewed` | 登录已续期，清除标记 |

**模型不可用时用 403 或 404 加厂商原话，不要用 401。**

## 10. 测试

```sh
bun test                                  # 模板自带：config 不覆盖、loader 签名、拉不到时保留列表
magpie_plugin_check({ dir })
magpie_sandbox({ action: 'install', name: 'dev', plugin: dir })
magpie_sandbox({ action: 'login', name: 'dev', provider: 'acme' })
magpie_sandbox({ action: 'test', name: 'dev', provider: 'acme' })
```

只测一个账号：`GET /v1/magpie/accounts` 拿 `pin`，请求带 `X-Magpie-Account: <pin>`，不走路由、不切换。

## 11. 隐私

插件能看到请求里的一切：对话、工具和结果。只发到用户要求的地方，**不要记日志**。
