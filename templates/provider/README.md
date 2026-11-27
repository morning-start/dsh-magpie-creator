# {{title}}

A [magpie](https://usemagpie.ai) provider plugin for **{{title}}**.

## What it signs in to

{{description}}

## How to sign in

An API key, saved as `{ type: "api", key }` in magpie's `plugin-auth.json`
(mode 600). The key never leaves this computer except in the requests it signs.

## Models

`{{id}}/…`, listed from the vendor's own `/models` when the account can be
asked, and from the package's default list until then.

## Use

```sh
magpie plugin add ./{{short}}   # a folder is loaded where it is
magpie plugin login {{id}}
magpie provider test {{id}}
magpie quota
```

In the app: **Plugins → Add a plugin**, give it the folder, then sign in on the
provider's row.

## Develop

```sh
bun test                              # the hooks, with fetch faked
bun ../../scripts/check.mjs {{short}} # load it the way magpie does
```

The whole thing runs in magpie's Bun plugin host. `auth.usage`, `auth.refresh`
and `auth.checkin` are magpie's own hooks; OpenCode ignores them, so this
package works there too.

## License

MIT
