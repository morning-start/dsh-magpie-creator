---
name: npm-package-manager
description: 管 npm 包**账号与 registry 那一侧**：第一次发布怎么引导、Trusted Publisher 怎么配/查/撤销、token 与 OIDC 谁优先、`latest` 与预发布 dist-tag、发完怎么对账、发错了怎么 deprecate 而不是 unpublish，以及 E404 / E403 / ENEEDAUTH / EOTP / 镜像警告各自是什么原因。当你要「发版」「配 trusted publisher」「npm 上版本不对」「dist-tag 指错了」「撤销信任」「deprecate」「首次发布」「npm 报 404/403/需要 OTP」时用。它只管 registry 那一侧；改版本、打包、沙盒演练属于本仓库的 `scripts/release.mjs` 与 `dsh_plugin_release`，不在这个技能里。
---

# npm 包管理（registry 侧）

这个技能只管**账号与 registry 那一侧**：信任关系、凭据、标签、弃用、对账。

**机械步骤不在这里。** 改版本号、就绪检查、打包、沙盒演练，走本仓库自己的发布工具：

```sh
node scripts/release.mjs <包目录>          # 就绪检查 + registry 条目 + 发布命令
npm test                                   # 全量测试
node scripts/check-project.mjs .           # 本仓库门禁
```

发出去那一下（`npm publish`、打 tag）和「发出去了但不对」之后的处理，才是这里的内容。

## 第一条：先分清自己在哪一段

判断包在不在 npm 上，**只用 `npm view`，不要凭记忆**：

```sh
npm view <包名> version
```

| 你在哪 | 判据 | 走哪 |
|---|---|---|
| 包名在 npm 上**还不存在** | 上面报 404 | 「引导」——必须本地发一次 |
| 包已存在，要发新版 | 上面有版本号 | 打 tag，CI 发；不要本地 publish |
| 版本发了但不对 | `npm view <包名>@<版本>` 与预期不符 | 「发错了怎么办」 |
| 只是要查/改信任关系 | —— | 「Trusted Publisher」 |

## 引导：新包名的第一次发布

Trusted Publisher 只能配在**已经存在**的包上，所以新包绕不过本地一次。先跑完本仓库的就绪检查，再：

```sh
npm login                      # 或环境变量里给 NODE_AUTH_TOKEN
npm publish --access public    # 首版；这一步无法带 provenance
```

发完立刻配信任（见下）。之后**留着 token 就一直用它发，删掉就切 OIDC**——两条都行，但在 CI 起来之前，别把 token 删早了。

## Trusted Publisher

四条命令，全部要**官方 registry**：

```sh
npm trust github <包名> --file publish.yml --allow-publish --dry-run   # 先看
npm trust github <包名> --file publish.yml --allow-publish             # 真配
npm trust list <包名>                                                  # 核对已配的
npm trust revoke <包名> --id=<trust-id>                                # 撤销（轮换用这个）
```

`--file` 填的是**这个仓库真实存在的那个工作流文件名**。本仓库是 `.github/workflows/publish.yml`，所以写 `publish.yml`；改了文件名就必须 `revoke` 旧的、配新的，否则发版认证失败。

规则（都实测过）：

- `--file` **只是文件名**，必须 `.yml` / `.yaml`——传路径报 `workflow must be just a file not a path`；
- `--repo` **可省**，省略时取 `package.json` 的 `repository`（不是 git remote）；清单里没写就必须显式给；
- **至少一个权限标志**：`--allow-publish`（直接发）或 `--allow-stage-publish`（别名 `--allow-staged-publish`），两个可同时加；
- 需要**账号 2FA 且对该包有写权限**；
- 另有 `npm trust gitlab` / `npm trust circleci`，权限标志是同一套。

**镜像会坏事。** 本机 `.npmrc` 常指向镜像，npm 会警告 `may not support trusted publishing`，然后对着镜像配信任。必须显式指定官方 registry：

```sh
--registry https://registry.npmjs.org
```

## 凭据：有 token 用 token，没有走 OIDC

本仓库的 `publish.yml` 就是这个顺序：有 `NPM_TOKEN` secret 就写进 `.npmrc` 用它，没有就走 OIDC。

| | token | OIDC |
|---|---|---|
| 什么时候用 | 仓库配了 `NPM_TOKEN` secret | 没配 secret |
| 优点 | 任何账号立刻可用，能建新包 | 没有长期密钥要轮换 |
| 代价 | 长期有效，要记得换 | 依赖那次 `npm trust` 配置 |

**永远不要让发布步骤因为「没 token」被跳过**——那会一路绿灯却没有版本发出去。这个坑真的踩过。

## 版本与 dist-tag

- `latest` 是别人 `npm i <包名>` 装到的那个。**只有真正的稳定版才推到 `latest`。**
- 预发版用 `next`：`npm publish --tag next`，装的人要显式 `@next`。别自造 `beta2` 这种名字——生态里没人会去猜。
- 改现成版本的标签：`npm dist-tag add <包名>@<版本> latest`。**这一步需要登录，CI 的 OIDC 票只覆盖 `publish`**，覆盖不了 dist-tag。
- 一个版本号**只能发一次**。发出去就改不了，只能发新版本。

## 发错了怎么办

| 情况 | 做法 | 不要做 |
|---|---|---|
| 版本内容有错 | 发一个补丁版本 | `npm unpublish`——24 小时后基本不可用，且会打断锁了版本的依赖 |
| 版本不该被安装 | `npm deprecate <包名>@<版本> "原因"` | 删包 |
| 信任配错了 | `npm trust revoke` 再重配 | 留着旧条目 |
| 发错标签 | `npm dist-tag add` 摆正 | 重新 publish 同一个版本（E403） |

`deprecate` 是**声明**：装了的人仍能装，但会看到警告。这正是它比删除好的地方。

## 报错反查

| 系统原文 | 真实原因 | 怎么办 |
|---|---|---|
| `404 Not Found - PUT https://registry.npmjs.org/<pkg>` | 不是包不存在，是**匿名发布**：没有凭据，也没配 Trusted Publisher | 加 token，或 `npm trust` 配一次 |
| `cannot publish over the previously published versions` | 这个版本已经在 registry 上 | 改版本号发新的；不要动旧 tag |
| `ENEEDAUTH` | 没登录，或 `.npmrc` 里的 token 没被带上 | `npm login` / 传 `NODE_AUTH_TOKEN` |
| `EOTP` / `one-time password` | 账号开了 2FA 且 CLI 没带 OTP | `--otp=<code>`，或改用 token/OIDC |
| `may not support trusted publishing` | registry 指向镜像 | 加 `--registry https://registry.npmjs.org` |
| `Granular access tokens ... may not perform this action` | granular token 不能改 trusted publisher | 去网页上配，配好后删掉 secret |
| `publish` 成功但 npm 上查不到 | 输出被管道吞了退出码（`npm publish \| tee`） | 看产物：`npm view <包名>@<版本>` |

**最后一条最值得记**：`npm publish | tee log` 的退出码是 `tee` 的，发布失败也会「成功」。判断发没发出去只看 `npm view`。

## 发完对账（三句话）

```sh
npm view <包名> dist-tags --json          # latest 是不是你刚发的
npm view <包名>@<版本> version            # 这个版本真的存在
npm view <包名>@<版本> dist.attestations  # 有没有 provenance
```

CI 发出来的包应该**有** provenance；本地引导那一次没有，且补不回来。

## 不要做

- 不要本地 `npm publish` 日常版本——没有 provenance，版本与标签也只在推 tag 那一刻对账。
- 不要 `unpublish`；用 `deprecate`。
- 不要把已发布版本重新发一遍（E403）；改版本号。
- 不要在镜像 registry 上配 Trusted Publisher。
- 不要只信「Publish 步骤打勾」；看 `npm view` 的产物。
- 不要移动一个**已经被消费**的 tag（npm 上有版本、或 Release 已建）——那会让「tag 指向什么」不可信。