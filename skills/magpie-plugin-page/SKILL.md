---
name: magpie-plugin-page
description: 给 magpie 窗口做页面、面板和菜单项：页面（侧边栏一个标签）、面板（塞进 Agent / 用量 / 设置 / 供应商编辑页里的一块）、菜单项（供应商或 Agent 右键菜单里的一项），以及替代 magpie 自带的用量、资源库、路由、会话页。用户说「在 magpie 里加一页」「magpie 页面」「magpie 面板」「magpie 插件界面」「替换 magpie 的用量页」时用。
---

# magpie 里的页面

页面就是插件文件夹里的 HTML、CSS、JS：没有构建、不启动 Bun 宿主、不需要模型。它跑在 magpie 窗口里一个**只允许脚本的沙盒 iframe** 里，有自己独立的 origin。

先读 `magpie_plugin_new` 定形态，再回来做界面。生成页面用：

```
magpie_plugin_new({ kind: 'page', packageName: '@acme/notes', title: 'Notes', titleZh: '笔记', description: '…' })
```

## 1. 三种界面，一个包可以都要

| 形态 | 声明 | 出现在哪 |
|---|---|---|
| 页面 | `magpie.page` | 侧边栏「插件」分组里一个标签 |
| 面板 | `magpie.panels[]` | Agent 页末尾 / 用量概览末尾 / 设置里的「插件」标签 / 供应商编辑页 |
| 菜单项 | `magpie.actions[]` | 供应商右键菜单、Agent 的拖动柄菜单 |

```json
"magpie": {
  "page": { "title": "Notes", "titles": { "zh": "笔记" }, "file": "page/index.html", "icon": "page/icon.svg" },
  "panels": [{ "slot": "provider", "file": "ui/notes.html", "title": "Notes" }],
  "actions": [{ "id": "check", "menu": "provider", "title": "Check balance", "titles": { "zh": "查余额" } }],
  "permissions": ["usage:summary"]
}
```

- 面板 `slot` 只能是 `agents`、`usage`、`settings`、`provider`；一个插件最多 8 个面板；
- 菜单项 `id` 是小写字母、数字、短横线，最长 40；一个插件最多 8 项；没有页面就没有菜单项；
- `page.replaces` 可以取 `sessions`、`library`、`routing`、`usage`，顶替 magpie 自带的那一页（两个插件抢同一页时，插件列表里靠前的赢）。

## 2. 页面能拿到什么

```js
await magpie.ready                    // 窗口主题；10 秒内不说就被判为没回应
magpie.theme                          // { dark, lang, tokens }
magpie.onTheme(fn)                    // 主题变化时回调
await magpie.read('usage:summary', { period: 'today' })
await magpie.options.get()            // 这个插件自己的选项
await magpie.options.set({ ... })     // 每秒最多一次
magpie.openPlugin('some-package')     // 打开 npm 包详情，不安装
magpie.onAction(({ id, provider }) => {})   // 菜单项被点了
```

读取只有两种，而且必须在 `magpie.permissions` 里声明：

| 读取 | 给出 |
|---|---|
| `usage:summary` | `period` 为 `today` / `7d` / `30d` 的调用数、错误数、token、费用，和前 20 个模型 |
| `providers:list` | 每个供应商的 id 和名字 |

**没有任何读取会给出密钥、账号、登录信息或请求内容。** 页面能读到的都当作公开的。

## 3. 页面不能做什么（做了就白屏）

- 不能联网：`connect-src 'none'`，没有 `fetch`、WebSocket、`sendBeacon`、表单、iframe；
- 不能内联脚本：`<script>` 必须是文件，`<script src="…">`；
- 碰不到窗口、cookie、localStorage；
- 内联样式和 `data:` 图片可以。

样式：bridge 会加一份 magpie 自己的样式表，权重为零（`:where()`），所以页面自己的任何规则都能盖过它。跟着窗口走就用变量：`--magpie-bg`、`--magpie-fg`、`--magpie-accent`、`--magpie-accent-fg`，以及 `<html>` 上的 `data-theme`、`lang`、`color-scheme`。没写样式的地方本来就是 magpie 的样子。

## 4. 写页面的顺序

1. `index.html`：先引 `<script src="_magpie/bridge.js"></script>`，再引自己的脚本（`defer`）；
2. `app.js`：第一行 `await magpie.ready`，然后 `magpie.read` 拿数据、`magpie.options` 记住用户的选择；
3. `style.css`：用变量，别写死颜色；深色浅色都要看一眼；
4. 面板：**不要给 `html` 或 `body` 固定高度**，面板按内容撑开（最高 2400px）；
5. 错误：没接住的错误会显示「此页面已停止工作」和「重试」，所以 `read` 失败要自己 catch 并说人话。

## 5. 验证

```sh
bun test    # 模板自带：读取都声明了、页面不联网、引了 bridge、没有内联脚本
```

真机看：`magpie_plugin_check` 之后在沙箱里装上，然后交给用户开 magpie 窗口看那一页——沙箱里没有模型凭据，界面要用户自己点。**没看到渲染结果就不要说「显示正常」。**

页面自己的脚本错误在页面里只显示「Script error.」，真错误在窗口控制台里；让用户打开控制台看，或者把关键步骤用 `console.log` 打出来。

## 6. 常见坑

- 忘了 `magpie.ready`：页面 10 秒后显示没回应；
- 在 `package.json` 里声明了 `usage:summary`，代码里读的是 `usage:detail`：被拒；
- 面板里写了 `html, body { height: 100vh }`：面板高度塌掉或撑满；
- 用 `fetch` 去拿自己的数据：沙盒不允许，改成「页面 + 本地服务」的 host 形态（`main` 导出 `{ id, server }`，服务只给这个页面发 token），或者把数据放进 `magpie.options`；
- 菜单项点了没反应：`magpie.onAction` 要在页面里注册，点之前注册的会等它。
