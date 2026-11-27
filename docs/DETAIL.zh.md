# Magpie 模式

**Magpie** 是给「开发 magpie 插件」用的 agent 预设。它是 DSH 创造模式（`cordis` 预设）的副本，加上这个包的工具和 skill，于是一个任务既能检查正在运行的 Harness，又能驱动 magpie 命令行、沙箱和七套插件模板。

它不覆写任何自带预设。这个包插入一个新行，所以标准、PTC、极简、创造模式的组合完全不变；删掉这个包，那一行和这个模式一起消失。

## magpie 是什么

[magpie](https://usemagpie.ai) 把用户拥有的每个模型——订阅、编程套餐、API key、本地模型——放到一个本机网关后面，再让各个编程 agent 指向它。它运行 OpenCode 的供应商插件，所以为 OpenCode 写的插件不用改就能用；也运行注册了供应商的 pi 扩展包。

它的配置目录是 `~/.config/magpie`（设置了 `$XDG_CONFIG_HOME` 时是 `$XDG_CONFIG_HOME/magpie`），里面有 `plugins.json`、`plugins/`、`plugin-auth.json`、`plugin-providers.json`、`providers.json`、`usage.jsonl` 和 `settings.json`。插件能改的一切都在这里。

## 七种插件

| 形态 | 声明方式 | 跑在哪 | 能做什么 |
|---|---|---|---|
| 供应商 | `main` / `exports` | Bun 插件宿主 | 联网、定时器、npm 依赖、`$` |
| 网关中间件 | `magpie.middleware` | magpie 进程内 moejs | 一个文件、相对 import、`console.log` |
| 路由策略 | `magpie.gateway` + `strategies` | moejs | 每次 20 ms |
| 工具 | `magpie.tools` 或 `tool` 钩子 | Bun 插件宿主 | 每次 55 秒 |
| 页面 | `magpie.page` | 沙盒 iframe | 不能联网、不能内联脚本 |
| Agent | `magpie.agent` | moejs | 加载 1 秒、`connect` 1 秒 |
| 异步钩子 | `magpie.hooks` | Bun 插件宿主 | 默认 1 秒，`gatewayTimeoutMs` |

一个包可以同时是几种。带 host 部分的页面仍然是页面：只有 `main` 不算供应商，所以 `kindsOf` 先看包名、再看模块自己的钩子，才决定它是不是供应商。

## 工具

| 工具 | 只读？ | 回答什么 |
|---|---|---|
| `magpie_doctor` | 是 | magpie 在哪、版本、网关有没有在跑、配置目录、Bun 下载了没、装了哪些插件 |
| `magpie_plugin_new` | 写一个新目录 | 按一种形态生成包骨架，然后检查 |
| `magpie_plugin_check` | 是 | magpie 会拒绝加载什么，以及它会静默做别的事的地方；`load: true` 还会真的 import 它、用替身 client 调用它的插件函数 |
| `magpie_sandbox` | 只碰自己的目录 | 一个自己的 HOME、配置和端口的 magpie |
| `magpie_templates` | 是 | 有哪些模板，每种跑在哪个运行时 |
| `magpie_registry_entry` | 是 | `registry.json` 该怎么写（magpie 的插件页读的那份，一处类型不对就丢掉全部条目） |

`magpie_plugin_new` 和 `scripts/new-plugin.mjs` 调的是同一个引擎（`lib/scaffold.mjs`），所以两者产出的字节一致。

## 检查器知道什么

`lib/check.mjs` 把 magpie 文档说的、以及它加载器实际做的，写成规则。每条发现要么是 `fail`（magpie 拒绝加载，或者会静默做错事），要么是 `warn`（能加载，但作者多半想的是别的）。

**清单**：name 是小写 npm 名；version 是 semver；包声明了一种形态；供应商的入口按 magpie 自己的查找顺序（`exports["./server"]`、`main`、`exports["."]`，然后 `index.ts/tsx/js/mjs/cjs`）。

**供应商导出**：magpie 把**每个导出的函数**都当插件调用，所以一个辅助导出（`export function signRequest`）会让整个包加载失败。辅助函数要放在 `export const _internal = { … }` 上——社区插件已经这么做了。

**moejs 模块**（中间件、路由、Agent）：不能裸包名 import、不能 `require`、不能定时器、不能 `fetch`、不能 `process`、不能 `Buffer`、不能 `node:` import。中间件至少要导出 `onRequest`、`onEvent`、`onResponse`、`onProvider`、`onAccount`、`onUsage` 之一。

**页面**：必须加载 `_magpie/bridge.js`；不能有内联 `<script>`；每个 `src`/`href` 都要能解析到包内；`magpie.permissions` 只能写 `usage:summary` 和 `providers:list`；面板不能给 `html`/`body` 固定高度。

**Agent**：`id` 只用小写字母、数字、`.`、`_`、`-`；不能是 magpie 自己的 agent；`library.mcp` 必须配 `magpie` 认识的 `mcpFormat`。

**社区约定**：`@magpie-community/` 的包按形态命名，并且带 `magpie` 关键词。供应商包还需要在 keywords 里有 `opencode` 和 `auth`/`plugin`/`provider` 之一，否则 magpie 的插件页搜索（它向 npm 查 `<关键词> opencode`）找不到它。

**用例**：中间件的 `cases.json` 和路由的 `strategies.json` 按社区仓库那个 harness 认的形状检查，所以搬进那个仓库时测试不用改。

**还没查的**（magpie 文档里有、检查器没有对应规则，所以全绿证明不了这些）：

- **中间件 / 路由的导入**：文档说 moejs 里只能用相对路径导入，且没有 `node_modules`；检查器只认 `from "<裸包名>"`、`from "node:…"` 和 `require()`，`import("./dep.js")` 这种动态导入、`import type` 也一起漏过去。
- **路由策略的名字和导出**：`strategies[name]` 会变成 `<插件>/<name>`；检查器只确认 `strategies` 是个对象，不查值是不是「带 `order` 的函数或对象」，也不查这个键会不会和别的插件撞名。
- **异步钩子的返回值**：`onRequest` 改 `model`/`stream`/客户端工具会被回滚并算作失败，钩子必须用 `ctx.signal` 取消 `fetch`；检查器只查导出名和有无 `export default`。
- **中间件钩子的返回约定**：`ctx.reject(status, message)` 只在 `onRequest`/`onProvider` 之前有效，`onAccount` 返回 `{ skip: true }` 表示跳过；检查器只看导出名，不看用法。
- **Agent 的 `library` 细节**：写了 `mcp` 没写 `mcpFormat` 现在算 fail；但 `launch` 里的占位符（`{key}`、`{url}`、`{v1}`、`{config}`）写错、`config` 是相对路径（文档要求展开 `~`/`$VAR`）、`startup` 里的 `keys` 没写，都还不查。
- **页面**：`magpie.permissions` 现在只认 `usage:summary` 和 `providers:list`；页面读不到密钥/账号，但 `openPlugin` 是 1.5 秒一次的限流——检查器不查调用频率。
- **面板槽位**：只查 `slot` 在四个里；文档说 `provider` 槽位对不提供 Provider 的插件也出现、最多 8 个（这个查了）、`<html>` 最高 2400px（只查了不给 `html`/`body` 固定高度）。
- **`registry.json` 的 `kind`**：`page`/`agent`/`tools`/`middleware`/`hooks` 都收，但 `providers` 与 `kind` 同时出现算不算错没有规则，magpie 那份读取器的处理也没有实测。
- **`magpie.privacyModels`**：命令路径是 `PATH` 上的、绝对路径、还是包里带斜杠的文件，检查器完全没碰。

检查器刻意保守：拿它跑社区仓库全部 65 个包，只报出一条，而且那条是真 bug（`agent-console` 引用了包内不存在的 `session.js`）。

### 加载它，而不只是读它

`--load`（也就是 `magpie_plugin_check { load: true }`）做的是社区仓库 `scripts/check.mjs` 做的事：像 magpie 的 Bun 宿主那样 import 入口，用一个替身 client 调用每个导出的函数，再检查返回的钩子的形状。这能抓到静态读源码抓不到的东西：少了 `auth.loader`、工具没有 `execute`、`config` 钩子没给供应商模型、入口 import 就抛错。

**只有供应商包有钩子要查**。中间件、路由、页面、Agent、异步钩子是 magpie 用别的方式加载的模块，而页面的 `{ id, server }` 默认导出是它的 host 部分，不是插件。把它们当 provider 查，正是这个检查器第一版对着真包报了三十条误报的原因。

## 上架列表（registry.json）

`registry.json`——magpie 插件页推荐的那份列表——是**整个**读进定型字段的，所以一处类型不对（`providers` 写成字符串、`community` 写成 `"true"`）丢掉的是**全部**条目，不只是自己那条。`lib/registry.mjs` 记着 magpie 读它的规则，`magpie_registry_entry` 生成一条能通过这些规则的条目。

| 字段 | 规则 |
|---|---|
| `package` | npm 包名，最长 214 字符 |
| `name` | 卡片上的名字 |
| `providers` | 供应商的条目：它登录的 id 列表 |
| `kind` | 其他形态：`middleware`、`hooks`、`agent`、`tools`、`page` |
| `community` | 布尔值，社区包写 `true` |
| `icon` | `https://` 或 `data:image/`，或 magpie 自带的图标名 |
| `summary` | `{ "en": …, "zh": … }`，两种语言都要有 |

从自己仓库发布的包不写 `community`：它就不在这些分组里，插件页的搜索按名字、简介或发布者能找到它，卡片显示它在 npm 上的发布者，不带 magpie 社区标记。

## 沙箱

`magpie_sandbox` 是唯一能证明「装得上」的办法。它把 `HOME`、`USERPROFILE`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`、`XDG_STATE_HOME` 指向一个临时目录，再给网关一个自己的端口，于是沙箱里没有插件、没有登录、没有供应商、没有用量。状态存在 `<沙箱>/sandbox.json`，所以沙箱跨次复用。

子进程拿到的环境是**恰好那一份**，不是调用方的：社区仓库的 `scripts/try.sh` 用 `env -i` 跑 magpie 是同一个道理——从 shell 继承来的变量可能把 magpie 指回真实的 home。只保留 PATH（Windows 上还有 SystemRoot 和临时目录变量）。Windows 上 magpie 的 home 取自 `USERPROFILE`，所以两个都设；只给 `HOME` 的话它会在做任何事之前就停下。

沙箱里 `magpie plugin` 打印的就是 magpie 真正加载到的东西——供应商的模型、中间件的钩子、工具名、页面权限、路由名。那一行是证据，别的都是猜。

## 发布

模板生成的包只是起点，"能上架"还有三段路，magpie 的规则各不相同：

- **npm**：`magpie plugin add opencode-acme-auth`、`…@0.2.0`、`github:owner/repo#ref`、`git+https://…`、`owner/repo`，或者直接给文件夹的路径（就地加载，不安装任何东西）。`bun add` 安装，**安装脚本不运行**，所以依赖 `postinstall` 构建的包用不了；包从用户已配好的 npm 源下载（`~/.npmrc` 的 `registry=`、`~/.bunfig.toml` 的 `install.registry`、`NPM_CONFIG_REGISTRY`/`BUN_CONFIG_REGISTRY`），`magpie plugin registry <url>` 改它，`default` 恢复。
- **链接**：`magpie://plugin?name=opencode-acme-auth` 停在这个包的详情页（README、发布者、安装按钮），**链接本身不装任何东西**。它只接 npm 包名——版本、路径、git、URL 都不接。
- **搜索**：插件页向 npm 查 `<关键词> opencode`，所以 keywords 要写成 `["opencode", "opencode-plugin", "<厂商>"]`（名字或 keywords 里有 `opencode`，加上 `auth`/`plugin`/`provider` 之一）。它还会查 `keywords:pi-package <关键词>` 找 pi 扩展包。
- **GitHub**：仓库打上 `magpie-plugin` topic 才会出现在「插件 → 发现 → 非官方插件 · GitHub」里。`package.json` 必须在仓库根目录；发到 npm 且 `repository` 指向这个仓库的从 npm 装，否则**按仓库当前代码装**——所以它加载的文件必须提交进仓库，只在发布时构建 `dist` 的仓库不会显示；fork、已归档的、`magpie-community` 自己的仓库都不显示。`magpie.name`（一行 ≤80 字节）和 `magpie.summary`（`{en, zh}`，每种语言 ≤300 字节）用来替仓库名和描述，卡片会标「包自己的话」。
- **社区**：贡献到 `magpie-community/plugins`，放 `packages/<name>`，包名 `@magpie-community/opencode-<name>-auth` / `middleware-<name>` / `tools-<name>` / `page-<name>` / `agent-<name>`，除非确实需要不要有运行时依赖；改版本号推到 `main` 就发布，这些包在每个 magpie 里自动更新。
- **推荐列表**：`registry.json` 每六小时拉一次、内置一份副本；`MAGPIE_PLUGIN_MARKET=<url>` 换一份列表用来**检查自己的条目**，设 `off` 只用内置副本。

这些是 magpie 的规则，不是我们的；`magpie_plugin_release` 里能自动化的只有前两步（npm 与 `registry.json` 条目），`magpie://` 链接和 GitHub topic 是用户要在自己那边点的。

## 预设副本

`cordis.patch.yml` 复述了创造模式整段插件列表，因为 patch 不做深合并，预设的 `plugins` 数组是替换而不是追加。这份副本是 DSH 0.2.2-rc.5 的。`scripts/check-patch.mjs` 拿它和已安装的 `@deepseek-ai/dsh-web-app/presets/cordis.patch.yml` 比，DSH 多了这一份没有的行就失败——否则 Magpie 模式会在升级时悄悄丢掉它们。

桌面版把 DSH 装在 `app.asar` 里，普通 `node` 读不到。把文件复制出来用 `--upstream` 传，或者设置 `DSH_WEB_APP_DIR`。

## 已知限制

- 沙箱里没有模型凭据：页面要用户自己在 `magpie web` 里看，真请求要真实的供应商。
- 检查是静态的，证明不了厂商的登录能走通。
- `magpie_sandbox` 调的是用户的 magpie；没装 magpie 时只能报告这一点。
- 工具只在 Magpie 模式里可见。要挂进别的预设，改 `cordis.patch.yml` 里 `preset-magpie` 的 `plugins` 列表。
