---
name: magpie-plugin-new
description: 把「我想给 magpie 加点什么」变成可运行的插件包：先判断这是哪一类插件（供应商 / 网关中间件 / 路由策略 / 工具 / 页面 / Agent / 网关钩子），再用 magpie_plugin_new 生成骨架、按检查报告修完、在沙箱里装起来验证。用户说「写一个 magpie 插件」「给 magpie 加个供应商 / 订阅」「让所有 agent 都能用某个工具」「在 magpie 窗口里加一页」「接一个 magpie 还没支持的 Agent」「magpie 插件怎么开始」时用。
---

# 从需求到 magpie 插件

magpie 的插件不是一种东西，而是七种，运行的地方、限制、测试方式都不一样。**先定形态，再生成**：形态错了，生成的包一定返工。

先跑一次 `magpie_doctor`，确认这台机器上 magpie 在哪、网关在不在、Bun 宿主有没有下载好。缺什么就告诉用户怎么补，别自己装。

## 1. 定形态：七选一

| 需求长什么样 | 形态 | 跑在哪 | 包名前缀 |
|---|---|---|---|
| 某个订阅 / 厂商的模型，magpie 自己没登录 | 供应商（OpenCode 插件） | Bun 插件宿主 | `opencode-<name>-auth` |
| 改请求或回复（别名、加系统提示词、拦敏感词、去 think 标签） | 网关中间件 | magpie 进程内 moejs | `middleware-<name>` |
| 决定一个号池 / 分组先试哪个账号 | 路由策略 | moejs | `middleware-<name>` |
| 给每个 agent 一批工具 | 工具 | Bun 插件宿主 | `tools-<name>` |
| 在 magpie 窗口里加一页 | 页面 | 沙盒 iframe | `page-<name>` |
| magpie 没内置接入的 Agent | Agent 插件 | moejs | `agent-<name>` |
| 每个请求前等 I/O（召回记忆、采集对话、通知） | 异步网关钩子 | Bun 插件宿主 | `gateway-<name>` |

判断口诀：

- **要联网、要等、要存东西** → Bun 宿主（供应商、工具、钩子）。
- **每个请求、每个流式事件都要过一遍** → moejs（中间件、路由、Agent），因为它没有定时器、没有 `fetch`、没有 Node API，只有一个文件。
- **只是给用户看的界面** → 页面，它连网络都碰不到。

一个包可以同时是几种（比如页面 + 供应商），但第一版只做一种。

## 2. 一次问清字段

必填：

| 字段 | 问法 |
|---|---|
| `packageName` | 包名。社区仓库用 `@magpie-community/<前缀>-<名字>`，自己的仓库随便，但建议同前缀 |
| `description` | 一句话：做什么 + 从哪儿出现。这段会进 README 和卡片 |
| `kind` | 上面七种之一（包名前缀能推出来，推不出来才问） |

按需：

- `title` / `titleZh`：显示名；页面和卡片会用到中文名；
- `id`：供应商 id（只属于你的，别用 `google`、`openai`、`anthropic`、`magpie`，否则会变成 `<id>-plugin`）；
- `baseUrl`：供应商的接口地址；
- `dir`：生成到哪，默认是会话目录下的短名文件夹。

问完复述一遍再生成。

## 3. 生成

```
magpie_plugin_new({
  kind: 'provider',
  packageName: '@magpie-community/opencode-acme-auth',
  title: 'Acme',
  description: 'Acme Coding Plan：复用 Acme 桌面端的登录，含实时模型目录与每日签到',
  id: 'acme',
  baseUrl: 'https://api.acme.example/v1',
})
```

生成器是确定性的：同一组参数永远产出同样的文件。**不要手写 package.json 再改**，也不要复制模板目录——生成器会顺带跑一遍检查。

生成的包里除了入口和测试，还有 `README.md` 和 `.github/workflows/publish.yml`：改版本号、打 `v<版本>` tag、推上去，GitHub Actions 就会跑测试并发布到 npm。发版细节见 `magpie-plugin-release`。

包做完就用 `node scripts/repo-handler.mjs <包目录>` 处理仓库：没有仓库就建一个公开的；已有仓库就更新可见性、补 `magpie-plugin` topic（magpie 的「发现」靠它），并把 `package.json` 的 `repository` 指过去。

命令行等价物（无人对话时用）：

```sh
node scripts/new-plugin.mjs --kind page --name @magpie-community/page-notes --dir ./notes --title Notes
```

## 4. 读检查报告，别跳过 warn

`magpie_plugin_new` 返回自带一次 `magpie_plugin_check`：

- `fail` 必须修。模板本身是 0 fail；出现 fail 说明输入有问题（包名非法、目录非空）。
- `warn` 逐条看，常见的几条：
  - `community-name`：社区仓库的包名要按前缀命名；
  - `repository`：没有 repository 的包不能从 npm 装、卡片也不好看；
  - `icon`：`magpie.icon` 给了包外路径，换成 `https://` 或 `data:image/`。

## 5. 填实现，然后跑测试

模板里每个文件顶部都写了这个文件跑在哪、能做什么、不能做什么。改完：

```sh
bun test          # 模板自带测试：供应商的钩子、中间件的 cases.json、路由的 strategies.json、页面的读取与网络
```

测试挂了先看是不是模板断言写错了，再看实现。

## 6. 在沙箱里装起来（唯一能证明「能装」的办法）

**永远不要往用户自己的 magpie 里装正在开发的插件。** 用 `magpie_sandbox`：

```
magpie_sandbox({ action: 'create', name: 'dev', plugin: '<生成的目录>' })
magpie_sandbox({ action: 'install', name: 'dev', plugin: '<生成的目录>' })
magpie_sandbox({ action: 'list', name: 'dev' })
```

`list` 的输出就是 magpie 真正加载到的东西：供应商列出的模型、中间件导出的钩子、工具名、页面读的权限、路由名。**看到这一行才算装上**。

- 供应商还要登录：`magpie_sandbox({ action: 'login', name: 'dev', provider: '<id>' })`，然后 `test` 发一个很小的请求；
- 页面要在 magpie 窗口里看：把 `command` 给出的环境变量交给用户，让他自己开 `magpie web`（沙箱里没有模型凭据，模型要用户自己加）；
- 中间件、路由、钩子要真请求才生效：沙箱里加一个供应商（哪怕是假的 key），发一次请求看日志。

## 7. 交付时说什么

- 包在哪、是哪一类、跑在哪个运行时；
- 检查报告：0 fail 几条 warn，warn 为什么不修；
- 沙箱里 `list` 看到了什么（原样贴那一行）；
- 哪些没验：页面长什么样、真实厂商的登录、真请求的效果——这些要么用户自己看，要么在沙箱里补。

## 不要做

- 不要往用户的 magpie 里 `magpie plugin add`（除非用户明确要求，并且知道自己在装什么）；
- 不要把「生成了」说成「装好了」；
- 不要在 moejs 插件里用 `fetch`、`setTimeout`、`process`、`Buffer`、裸包名 import——检查器会拦，magpie 也会静默跳过；
- 不要给页面加内联 `<script>` 或让它联网——沙盒策略不允许，页面会直接白屏。
