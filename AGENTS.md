# 开发 dsh-magpie-creator

这份文件给**改这个仓库的人或 agent**看：结构、开发循环、门禁、发版。

| 文件 | 写给谁 | 放什么 |
|---|---|---|
| `README.md` | 用户 | 这个包是什么、装了什么、怎么用。不写开发流程 |
| `AGENTS.md` | 开发者 / agent | 怎么改、怎么测、怎么发（本文件） |
| `docs/DETAIL.md`、`docs/DETAIL.zh.md` | 想深入的人 | 检查器知道什么、沙箱怎么搭、每条发布路径的规则 |

改 README 前先想一句：用户读到这段，是在决定「要不要装、怎么用」吗？不是的话，它属于这里或 `docs/`。

## 这个仓库是什么

一个 DSH bundle：一条 Host 行加一个 `magpie` 预设（`cordis.patch.yml`），再加 7 个工具、8 个 skill、7 套模板和一套检查 / 沙箱 / 发布用的 lib 与命令行。它自己不执行 magpie 插件，而是生成、检查、在沙箱里装、并帮你发布 magpie 插件。

## 结构

```
index.js              Host 行，只占位；注册东西都写在 ctx.effect 里
cordis.patch.yml      bundle patch：Host 行 + magpie 预设（含逐字复制的 preset-cordis 段）
tools/index.js        7 个工具，只挂进 magpie 预设
lib/                  magpie 定位、包检查、加载检查、脚手架、沙箱、registry、doctor、隐私扫描、建仓库
skills/               8 个 skill，各自一个目录一个 SKILL.md
templates/            7 种 magpie 插件的最小实现，带测试；`_release/` 是共用的发版工作流
scripts/              13 个命令行入口，和工具共用 lib/
test/                 150 个测试（node --test）
docs/                 实现说明与验证记录
market.json           商店卡片元数据
checks.json           本仓库自己的检查规则（dsh_project_check）
.github/workflows/    check.yml（push/PR）、publish.yml（tag）
```

## 开发循环

1. 改代码。逻辑在 `lib/`，工具入参在 `tools/index.js`，命令行入口在 `scripts/`。
2. 跑 `node scripts/check-project.mjs .`：manifest、patch 对齐、技能格式、语法、隐私扫描、150 个测试，一次跑完。必须全绿。
3. `dsh_plugin_check`（0 fail）和 `dsh_project_check`（`checks.json` 0 fail）也过一遍。
4. 动到发布面（`package.json` 的 `files`、入口、依赖）时，再跑 `dsh_plugin_release check` → `pack` → `rehearse`，确认打出来的包能在沙箱里装上、组合出来。
5. 新增工具 / skill / 模板时，这些地方要一起改：`tools/index.js`（注册）、`locale/en.json` + `locale/zh.json`（键要对称）、`checks.json`（skill 的 frontmatter 规则）、`README.md` 的工具 / 技能表、模板列表。

## 硬约束

- `cordis.patch.yml` 里 `# --- shipped preset-cordis ---` 到 `# --- end shipped ---` 是 DSH 对应版本的**逐字拷贝**，只调了缩进。DSH 升级后整段重拷，不要在中间手改；`scripts/check-patch.mjs` 会发现漂移。
- `lib/` 和 `tools/` 不写 `console`（`checks.json` 的 `no-console`）。
- 不要把密钥、token、本机路径、作者邮箱写进代码、测试、fixtures 或截图；`check-privacy` 会拦，`check.yml` 在每次 push 时都跑。
- `package.json` 的 `files` 决定发布内容：新增顶层目录要加进去；`test/`、`tmp/` 不加。
- 改 `package.json` 只改必要字段，不要整文件重排——一次重排会把发版 diff 变成几百行噪音。
- `templates/_release/.github/workflows/publish.yml` 是所有新项目共用的发布流水线：改它等于改每个脚手架项目的发版行为。`test/scaffold.test.mjs` 会检查每种模板都带上它、且没有未替换的模板占位符。
- `tmp/`、`sandboxes/`、`.magpie*` 不提交。

## 测试

```sh
npm test                                    # node --test test/*.test.mjs
node scripts/check-project.mjs .            # 上面这些 + patch、技能、隐私
```

新增行为配一个新测试。改检查规则时，先对着真实包跑一遍（`docs/DETAIL.md` 记录了社区仓库的对照结果），确认没有新增误报，再写进测试。

## 发版

版本号：修 bug / 文案 → patch；加工具、skill、模板 → minor；破坏已有的工具入参或预设结构 → major。

发版就是一个 tag（改动先提交，工作树要干净，`npm version` 才肯跑）：

```sh
npm version patch          # 提版本、提交、打 tag v0.1.1
git push --follow-tags     # 推 main 和 tag
```

`.github/workflows/publish.yml` 只在 tag 上跑：核对 tag 与 `package.json` 的版本号（不一致直接失败）、跑 `check-project`、`npm publish --provenance --access public`、用 tag 开 GitHub Release。

- 认证两条路：npm trusted publishing（OIDC），在包设置里把仓库和 `publish.yml` 配成 trusted publisher；或者仓库 secret `NPM_TOKEN`，工作流检测到就用它写 `.npmrc` 再发布。两者都在时 secret 优先，删掉 secret 就回到 OIDC。
- granular token 不能改 trusted publisher（npm 会 403：「Granular access tokens that bypass two-factor authentication may not perform this action」）——要上 OIDC 只能在网页上配，配好后删掉 secret。
- 这个包 0.2.0 用的是本地手动发，0.2.1 起由仓库 secret `NPM_TOKEN` 发；新包首版也可以加 secret 后直接 tag（工作流用 token 建包），不配 secret 才需先本地手动发一次。
- token 是长期密钥，能配 OIDC 就配 OIDC。
- 已经发过的版本不能重发：改代码，发下一个 patch。
- 发错了：`npm deprecate dsh-magpie-creator@<版本> "原因"`，再发一个补丁版；不要 `npm unpublish`。

发布后在一个干净 profile 里装一次，确认模式卡、工具、skill 都在：

```sh
dsh plugin --profile <profile> add dsh-magpie-creator@<版本>
```

## 发布前清单

- [ ] `node scripts/check-project.mjs .` 全绿（150 个测试）
- [ ] `dsh_plugin_check` 0 fail
- [ ] `dsh_project_check` 0 fail
- [ ] `dsh_plugin_release check` 和 `rehearse` 通过
- [ ] `README.md` 的工具 / 技能 / 模板表和实际一致
- [ ] `package.json` 版本号、`market.json`、README 的说法同步
- [ ] 这次改动没有混进无关的格式重排