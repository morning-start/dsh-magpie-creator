---
name: magpie-plugin-release
description: 把 magpie 插件发出去：版本号、npm 发布、magpie:// 链接、社区仓库 registry.json 条目、GitHub magpie-plugin 标签、发版前检查清单。用户说「发布 magpie 插件」「上架 magpie」「提交到 magpie-community」「magpie 插件怎么让别人装」时用。
---

# 发布一个 magpie 插件

插件有三种被装上的方式，发布前先想清楚走哪条：

| 方式 | 用户怎么装 | 需要什么 |
|---|---|---|
| npm | `magpie plugin add <包名>` | npm 上有一个包 |
| git | `magpie plugin add github:owner/repo` | 仓库里直接能加载的文件 |
| 文件夹 | `magpie plugin add ./文件夹` | 什么都不需要，只适合自己用 |

社区仓库（`magpie-community/plugins`）的包还会在 magpie 启动后不久、之后每小时自动更新。

## 1. 发版前检查

```
magpie_plugin_check({ dir: '<包目录>', load: true })
```

必须 0 fail。`load: true` 会真的 import 这个包、用一个替身 client 调用它的插件函数（社区仓库的 `scripts/check.mjs` 就是这么做的），能抓出静态读源码看不出来的毛病：`auth` 少了 loader、工具少了 `execute`、`config` 没给供应商模型。

然后逐条过：

- [ ] `package.json` 有 `name`、`version`、`description`、`license`、`repository`、`files`；
- [ ] `repository` 指向这个 GitHub 仓库——provenance 需要它，工作流会先核对，不一致直接失败；
- [ ] `files` 只列真正要发的（入口、README、页面资源），测试和 fixtures 不发；
- [ ] README 写清楚：登录什么、怎么登录、登录信息存在哪、有哪些模型（或：它做什么、从哪儿出现）；
- [ ] `magpie.icon` 是 `https://` 或 `data:image/`，或者干脆不写（用拼图图标）；
- [ ] 供应商包的 keywords 里有 `opencode` 和 `auth`/`plugin`/`provider` 之一——**插件页的搜索靠这个**（它向 npm 查 `<关键词> opencode`）；
- [ ] `bun test` 全绿；
- [ ] 在沙箱里装过、`magpie_sandbox list` 看到它加载成功。

`node scripts/release.mjs <包目录>` 会把上面能自动查的查一遍，并打印 registry 条目和发布命令。

## 2. 上架列表（registry.json）

想被 magpie 的「插件 → 发现」推荐，就往社区仓库的 `registry.json` 加一项。**这份文件 magpie 整个读进定型字段，所以一处类型不对就丢掉全部条目**，不是只丢自己那条。

```
magpie_registry_entry({ dir: '<包目录>', summaryZh: '<中文一句话>', providers: ['<id>'] })
```

它按 magpie 自己的读法检查这条，并给出可以直接粘的条目：

| 字段 | 规则 |
|---|---|
| `package` | npm 包名，最长 214 字符 |
| `name` | 卡片上的名字 |
| `providers` | 供应商才写：它登录的 id 列表 |
| `kind` | 非供应商才写：`middleware` / `hooks` / `agent` / `tools` / `page` |
| `community` | 布尔值，社区包写 `true` |
| `icon` | `https://` 或 `data:image/`，或 magpie 自带的图标名 |
| `summary` | `{ "en": …, "zh": … }`，两种语言都要有 |

常见的错：`providers` 写成字符串、`community` 写成字符串 `"true"`、`kind` 写了 `"provider"`（供应商不写 kind）、多了一个 magpie 不认识的字段、`summary` 少一种语言。

`scripts/check-registry.mjs <registry.json>` 查一整份文件；`scripts/check-registry.mjs <包目录>` 生成并校验一个包的条目。

## 3. 版本号与 tag

- 第一次发布 `0.1.0`；
- 修 bug 发补丁位，加钩子 / 加工具发次版本位；
- tag 用 `v<version>`（例如 `v0.1.1`）；版本号只改 `package.json`，tag 跟着它走；
- 社区仓库：**把版本号改动推到 `main` 就会发布**（`publish.yml` 先打 dist 包，再发 npm）；新包合并后立刻可用，不用等 npm。

## 4. 发版：tag 触发流水线

`magpie_plugin_new` 生成的包自带 `.github/workflows/publish.yml`，本地只做三件事：

1. 改 `package.json` 的 `version`；
2. 提交；
3. 打 tag 推上去：

```sh
git tag v0.1.1
git push --follow-tags
```

嫌两步麻烦可以用 `npm version patch`：它改 `version`、提交、再打一个 `v` 开头的 tag（要求工作树干净），之后 `git push --follow-tags` 就行。

工作流会核对 tag 与 `package.json` 的版本（不一致直接失败）、核对 `repository` 指向当前 GitHub 仓库（provenance 需要）、跑 `bun test`、`npm publish --provenance --access public`，再开一个 GitHub Release。

- 认证两条路：在 npm 包设置里把仓库和 `publish.yml` 配成 trusted publisher（OIDC），或者给仓库加一个 `NPM_TOKEN` secret——工作流检测到 secret 就用它写 `.npmrc`，两者都在时 token 优先；
- 没有这个文件的老包，手动发：`npm publish --access public`；
- 包名带 scope 时要 `--access public`；
- 安装脚本不会运行（magpie 用 `bun add` 且不跑 install scripts），所以**不要依赖 postinstall 构建**。

**第一次发布是例外**：npm 只给已经存在的包配 trusted publishing，所以 `0.1.0` 要在本地手动发一次：

```sh
npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"
npm publish --access public
```

发完去 npm 包设置里配 trusted publisher（这个仓库 + `publish.yml`），或者给仓库加一个 `NPM_TOKEN` secret；从下一个版本起才走 tag 和 Actions。工作流里也拦了一道：包还不在 npm 上时，它直接告诉你要先手动发，而不是抛一个看起来像权限问题的 404。

## 5. 让用户找到它

**magpie:// 链接**（只接受 npm 包名，不接受版本、路径、git、URL）：

```
magpie://plugin?name=@magpie-community/opencode-acme-auth
```

打开 magpie 的插件页停在这个包的详情上（README、发布者、安装按钮），**链接本身不安装任何东西**，由用户点。

**搜索**：插件页的搜索向 npm 查 `<关键词> opencode`，只显示名字或 keywords 里同时有 `opencode` 和 `auth` / `plugin` / `provider` 之一的包。所以供应商插件的 keywords 至少写：

```json
"keywords": ["opencode", "opencode-plugin", "<厂商>", "magpie"]
```

**社区推荐列表**：在 `magpie-community/plugins` 的 `registry.json` 里加一项，提 PR。

```json
{
  "package": "@magpie-community/opencode-acme-auth",
  "name": "Acme",
  "icon": "https://acme.example/icon.svg",
  "providers": ["acme"],
  "community": true,
  "summary": { "en": "Your Acme Coding Plan.", "zh": "使用你的 Acme Coding Plan。" }
}
```

- 供应商写 `providers`，不写 `kind`；
- 中间件 / 路由写 `"kind": "middleware"`，不写 `providers`；
- 工具 `"kind": "tools"`、页面 `"kind": "page"`、Agent `"kind": "agent"`、异步钩子 `"kind": "hooks"`；
- 社区包写 `"community": true`；从自己仓库发的包不写，它不在这些分组里，靠搜索找到；
- **同一个渠道只收一个包**：已经有人做过同一个厂商，就要在 PR、README 和 `summary` 里说清差在哪（怎么登录、调哪个接口、支持什么），说不出来不会合并。

用 `magpie_registry_entry` 生成并校验这一项，别手写——一处类型不对就丢掉全部条目。

**GitHub 标签**：仓库打上 `magpie-plugin` topic，会出现在「插件 → 发现 → 非官方插件 · GitHub」，按 Star 排序，标明没人审阅。`node scripts/repo-handler.mjs <包目录>` 一次处理两种状态：目录还没有仓库，就建一个公开的并推上去；已经指向 GitHub 仓库，就只更新可见性（改成公开）、补 topic、把 `package.json` 的 `repository` 对齐过去（provenance 要它）。`--dry-run` 先看它要跑什么。`package.json` 必须在仓库根目录；没发 npm 的，从仓库当前代码安装，所以**它加载的文件必须提交进仓库**（只在发布时构建 `dist` 的仓库不会显示）。fork、归档仓库和 magpie-community 自己的仓库不显示。

## 6. 发布之后

```sh
magpie plugin add <包名>@<版本>
magpie plugin            # 确认它列出的东西
magpie plugin update     # 用户那边怎么更新
```

- 固定了版本的写法（`name@1.2.3`）会停在那个版本，直到用户更新；
- git 仓库没有版本号可比，按分支 / 标签的最新提交判断有没有更新；
- 社区包自动更新；其他包在插件页显示小圆点，用户点「全部更新」。

## 7. 不要做

- 不要把密钥、cookie、账号邮箱、真实 token 写进 README、测试、fixtures 或截图；
- 不要在插件里记录用户对话内容（插件能看到请求里的一切，只发到用户要求的地方，不要写日志）；
- 不要为了「能装」而把 `dist` 排除在仓库外又指望 GitHub 安装；
- 不要在没有真实测过的情况下写「已验证」。
