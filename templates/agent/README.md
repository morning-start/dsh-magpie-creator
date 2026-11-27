# {{title}}

An agent on [magpie](https://usemagpie.ai)'s Agents page: {{description}}

Once added, {{title}} is on the Agents page like the agents magpie ships with.
Pick one of magpie's models in its row and magpie writes it into the agent's
config, with the gateway's address and a key of the agent's own; switch it off
and every key goes back to what the user had.

## The agent export

| Field | Meaning |
|---|---|
| `id` | its id on the Agents page, in usage and in the CLI |
| `name` | what the page calls it |
| `config` | the file magpie edits (`~` and `$VAR` expanded) |
| `format` | `json`, `yaml`, `toml` or `env`, when the file name does not say |
| `model` | the key of the model in the file, as a dotted path |
| `bin`, `dir` | the command and folder that say the agent is installed |
| `ua` | words of the agent's User-Agent, to name its requests in Usage |
| `notice` | said after its model changes |
| `library` | `{ instructions, mcp, mcpFormat, skills }`: what the Library writes into it |

`connect(input)` returns the other keys to write beside the model, by key path.
It gets `gateway` (`url`, `v1`, `key`), `model` and `models`.

## Use

```sh
magpie plugin add ./{{short}}
magpie agents          # {{title}} is listed
magpie {{id}} deepseek/deepseek-chat
```

## Develop

```sh
bun test
```

The file runs on moejs inside magpie: one file, no imports from outside the
package, no timers, no `fetch`. Loading and `connect` each have a second; a
module that does not load, or a `connect` that throws, says why on its row and
writes nothing.

## License

MIT
