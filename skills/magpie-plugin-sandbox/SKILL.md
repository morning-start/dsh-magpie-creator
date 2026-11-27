---
name: magpie-plugin-sandbox
description: 用沙箱测 magpie 插件：一个不碰用户自己 magpie 的独立 magpie（自己的 HOME、配置目录、网关端口），在里面装插件、看 magpie 真正加载到了什么、登录、发请求、读日志。用户说「测一下这个 magpie 插件」「在沙箱里装」「magpie 插件验证」「别动我的 magpie」时用。
---

# 在沙箱里测 magpie 插件

**用户自己的 magpie 里装着真实登录、真实供应商、真实用量。** 正在开发的插件永远先进沙箱。

## 1. 沙箱是什么

一个文件夹，里面是自己的 `HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`、`XDG_STATE_HOME`，再加一个自己的网关端口（默认从 3499 起）。magpie 把一切都放在配置目录里（`plugins.json`、`plugins/`、`plugin-auth.json`、`providers.json`、`usage.jsonl`），所以换掉这些路径就是一个干净、独立的 magpie。

沙箱状态存在 `<沙箱目录>/sandbox.json`，**跨次复用**：同一个插件一直用同一个沙箱，直到你删掉它。

## 2. 四个动作

```
magpie_sandbox({ action: 'create',  name: 'dev', plugin: '<包目录>' })
magpie_sandbox({ action: 'install', name: 'dev', plugin: '<包目录>' })
magpie_sandbox({ action: 'list',    name: 'dev' })
magpie_sandbox({ action: 'command', name: 'dev' })
```

- `create`：建文件夹、记下端口和插件路径，打印在沙箱里跑 magpie 的环境变量；
- `install`：在沙箱里 `magpie plugin add <目录>`。第一次会下载 Bun 宿主（几秒到几十秒），之后很快；
- `list`：在沙箱里 `magpie plugin`——**这就是 magpie 真正加载到的东西**；
- `command`：把环境变量交给用户，让他自己开 `magpie web` 看界面、加模型。

还有 `login`、`test`、`status`、`remove`（`remove` 要 `confirm: true`）。

命令行等价物：

```sh
node scripts/sandbox.mjs create dev
node scripts/sandbox.mjs install dev ./my-plugin
node scripts/sandbox.mjs list dev
node scripts/sandbox.mjs run dev -- quota
```

## 3. `list` 的输出怎么读

```
./my-plugin  on
  acme (Acme, 2 models)  not signed in · magpie plugin login acme
```

- 第一行：包、开关状态；
- 供应商：`<id> (<名字>, N models)` 和登录状态；
- 中间件：`gateway middleware  onRequest, onEvent, onResponse`——**列出来的钩子就是它真的导出的钩子**；
- 工具：`tools  <插件短名>_<工具名>`；
- 页面：`page  <标题> (reads usage:summary)`；
- 路由：`gateway middleware  routings <插件短名>/<策略名>`；
- 异步钩子：`async gateway hook  onRequest`；
- Agent：出现在 `magpie agents` 里，显示「not detected」是正常的（它检查的是那个 Agent 装没装）。

看不到你的插件、或看不到它的钩子 / 工具 / 页面 / 路由 → 没加载成功，回去跑 `magpie_plugin_check`。

## 4. 按插件类型往下测

| 类型 | 还要做什么 |
|---|---|
| 供应商 | `login <provider>` 走每种登录方式；`test <provider>` 每种 API 发一个很小的请求；`run dev -- quota` 看 `auth.usage` |
| 中间件 | 沙箱里加一个供应商（假 key 也行），发一次请求，看钩子有没有被调用、有没有改写 |
| 路由 | 沙箱里加供应商和模型，`group add <名字> models=<模型> routing=<插件短名>/<策略>`，看分组里显示的路由名 |
| 工具 | `run dev -- tools` 列出工具，`run dev -- tool <插件短名>_<工具名> --参数 …` 直接调一次 |
| 页面 | `command` 拿到环境变量，交给用户开 `magpie web` 看那一页（沙箱里没有模型凭据，界面要用户自己点） |
| Agent | `run dev -- agents` 看到它；给沙箱里的 Agent 选模型后看配置文件有没有被写对 |
| 异步钩子 | 同中间件：发一次真请求，看 `plugin: …` 日志 |

## 5. 日志

沙箱的日志在沙箱自己的目录里，不会污染用户的日志。插件打印的一切都被记成 `plugin: …`。

## 6. 收尾

- 测完可以留着沙箱（下次接着用），也可以 `remove`（会删掉沙箱里的登录信息）；
- **永远不要**为了「测一下」往用户自己的 magpie 里装开发中的插件；
- 沙箱里登录的是测试账号，不要把真实账号的 token 拷进沙箱。
