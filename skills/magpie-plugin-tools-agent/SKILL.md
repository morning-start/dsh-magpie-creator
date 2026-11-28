---
name: magpie-plugin-tools-agent
description: 给 magpie 加工具（每个 agent 通过 /mcp/magpie/tools 都能用）和 Agent 插件（把 magpie 没内置接入的 Agent 放到 Agents 页，选模型即写配置、关掉即还原）。讲清工具的 JSON Schema、命名、55 秒超时、隐藏与按需加载，以及 Agent 的 agent 导出、connect、library、launch、merge 字段。用户说「给 magpie 加工具」「magpie MCP 工具」「让所有 agent 都能用 X」「magpie 接一个 Agent」「magpie Agent 插件」时用。
---

# 工具插件与 Agent 插件

## 一、工具插件

工具跑在 **Bun 插件宿主**里，magpie 把它们组成自己的 MCP 服务器 `/mcp/magpie/tools`（Streamable HTTP），**每个 agent 都能用**，不只是 OpenCode。

```
magpie_plugin_new({ kind: 'tools', packageName: '@acme/calc', title: 'Calc', description: '…' })
```

### 形状

```js
export const CalcTools = async () => ({
  tool: {
    eval: {
      description: '…做什么、什么时候该调用…',
      args: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      async execute(args, ctx) {
        return { exact: '3/10' }        // 字符串按文本发回，其他按 JSON
      },
    },
  },
})
```

- **只导出一个插件函数**：模块里每个导出的函数都会被当成插件，辅助函数放另一个文件；
- 工具名是 `<插件短名>_<工具名>`（`calc_eval`），名字本身 `[A-Za-z0-9_-]{1,48}`；
- `args` 是 JSON Schema（也可以是 `@opencode-ai/plugin` 的 zod），magpie 在 `execute` 之前校验，参数不对会回一个写明是哪个参数的错误；
- `execute` 自己也要校验：magpie 把参数原样传进来；
- 每个工具 55 秒，`ctx.abort` 到点触发；`ctx.agent` 是调用它的 agent；
- 工具以用户的权限在宿主里跑，结果只回给调用它的 agent。

### 用起来

```sh
magpie plugin add ./calc
magpie tools calc                       # 列出工具和参数
magpie tool calc_eval --expression "0.1+0.2"
claude mcp add --transport http magpie-tools http://127.0.0.1:3425/mcp/magpie/tools
```

- 每个提供工具的插件也在资源库的 MCP 页里成为一个独立服务器（以插件短名命名）；开了 MCP 路由时，工具名变成 `calc__eval`；
- 想保留供应商但不把工具给任何 agent：插件 → 已安装 → 工具那一行「对智能体隐藏」；
- 用网关密钥发起的调用计入那个密钥的限额。

### 测试

```sh
bun test    # 模板自带：名字、描述、args、execute
```

沙箱里：`magpie_sandbox({ action: 'run', name: 'dev' })` 不提供任意命令时，用命令行 `node scripts/sandbox.mjs run dev -- tools` / `-- tool calc_eval --expression 1+1`。

## 二、Agent 插件

Agent 插件把 magpie 没内置接入的 Agent 放到 Agents 页：选一个 magpie 的模型，magpie 把模型、网关地址和这个 Agent 自己的 key 写进它的配置；关掉开关，每个键都还原。

```
magpie_plugin_new({ kind: 'agent', packageName: '@acme/aider', title: 'Aider', id: 'aider' })
```

### 形状

```js
export const agent = {
  id: 'aider',                 // 小写字母、数字、. _ -；不能是 magpie 自己的 agent
  name: 'Aider',
  config: '~/.aider.conf.yml', // magpie 改的文件，~ 和 $VAR 会展开，不存在会新建
  model: 'model',              // 模型在文件里的键（JSON/YAML/TOML 用点分路径）
  prefix: 'openai/',           // 写在 magpie 模型 id 前面（走 LiteLLM 的 Agent 用）
  bin: 'aider',                // PATH 上的命令，用来判断装没装
  ua: ['aider', 'litellm'],    // User-Agent 里的词，用量里认出它
  notice: '…重启后生效…',
}

export function connect({ gateway, model }) {
  return { 'openai-api-base': gateway.v1, 'openai-api-key': gateway.key }
}
```

### 字段要点

| 字段 | 说明 |
|---|---|
| `format` | `json` / `yaml` / `toml` / `env`，文件名看不出格式时才写 |
| `startup` | 模型存在另一个文件时：`{ config, model, keys }`（PiG 就是这种） |
| `library` | `{ instructions, mcp, mcpFormat, skills }`：资源库写进它的东西。**有 `mcp` 就必须有 `mcpFormat`**，否则插件不加载 |
| `launch` | 只从启动方式读网关的 Agent：`{ env: { KEY: '{key}', BASE: '{url}' }, model: '--model', args: { '--settings': '{config}' }, plain: [...] }` |
| `base` | 配置由 `launch.args` 交给 Agent 时，Agent 自己的设置文件 |
| `merge` | json 配置里，`connect` 返回的成员写在用户自己的成员旁边 |
| `effort` / `wsl` / `aliases` | 推理强度一栏 / WSL 里也列出 / `magpie <名字>` 也认 |

`connect(input)` 拿到：`gateway`（`url`、`v1`、`key`）、`model`（`id`、`name`、`context`、`output`、`images`、`efforts`、`native_endpoints`、`pricing`）、`models`、`decisionModels`、`agent`。magpie 的模型变了会再调一次。

`own({ config, base, model })` 可选：给这一行的选择器列出 Agent 自己的模型。

### 运行方式

和中间件一样在 moejs 里跑：一个文件、只能 import 插件内的文件、没有定时器 / fetch / Node API。加载和 `connect` 各 1 秒。模块加载失败或 `connect` 抛错 → 那一行写明原因，什么都不写。

需要定时器、监视文件、把值同步进应用配置的 Agent，可以再带一个 Bun 模块作为 `main`（像供应商插件那样跑），但它仍然是 Agent 插件。

### 测试

```sh
bun test
magpie_sandbox({ action: 'install', name: 'dev', plugin: dir })
magpie_sandbox({ action: 'run', name: 'dev' })   # 或命令行：node scripts/sandbox.mjs run dev -- agents
```

Agent 在 `magpie agents` 里显示「not detected」是正常的：它检查的是那个 Agent 装没装。真正验证要给它选一个模型，然后看配置文件里写进去的键，再关掉看有没有还原——**在沙箱里做，沙箱的 HOME 是独立的，写坏的是沙箱里的配置**。
