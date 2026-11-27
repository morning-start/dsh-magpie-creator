# {{title}}

Tools for every agent behind [magpie](https://usemagpie.ai): {{description}}

magpie serves them on its own MCP server, `/mcp/magpie/tools`, and names each
one `<plugin>_<tool>` — `{{short}}_echo` here.

## Use

```sh
magpie plugin add ./{{short}}
magpie tools {{short}}          # what it gives, with parameters
magpie tool {{short}}_echo --text hi
```

Add the server to an agent that is not connected through magpie:

```sh
claude mcp add --transport http magpie-tools http://127.0.0.1:3425/mcp/magpie/tools
```

To keep the plugin's providers but give its tools to no agent, press **Hide from
agents** on its tools line under Plugins → Installed.

## Develop

```sh
bun test
```

`args` is JSON Schema (or a zod shape from `@opencode-ai/plugin`), magpie checks
a call against it before `execute` runs, and a tool has 55 seconds — `ctx.abort`
fires when they are up.

## License

MIT
