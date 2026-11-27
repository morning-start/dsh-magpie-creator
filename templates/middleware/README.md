# {{title}}

Gateway middleware for [magpie](https://usemagpie.ai): {{description}}

It runs on every request an agent sends through magpie's gateway and on the
reply on its way back, whichever provider serves it.

## Options

Set them in **Plugins → Installed → Options**, or:

```sh
magpie plugin options {{short}} '{"alias":{"from":"fast","to":"deepseek/deepseek-chat"}}'
```

| Key | Meaning |
|---|---|
| `alias` | `{ "from": "<model>", "to": "<provider/model>" }`: send an alias as the real model |
| `blocked` | model ids to turn away with 403 |

Options apply from the next request. A middleware runs with no options until
some are saved.

## Use

```sh
magpie plugin add ./{{short}}
magpie plugin options {{short}} '{"blocked":["openai/gpt-5.5"]}'
```

## Develop

```sh
bun test     # cases.json, run the way the gateway calls the hooks
```

The file runs in magpie's own process on moejs: one file, relative imports
only, no timers, no `fetch`, no Node APIs. A hook has 250 ms (50 ms per event);
one that throws or returns something else is skipped and the request goes on
unchanged. Settings → Plugins shows each middleware's calls, average time and
failures.

## License

MIT
