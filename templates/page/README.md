# {{title}}

A page in [magpie](https://usemagpie.ai)'s window: {{description}}

Once the plugin is on, the page has a tab in the sidebar's **Plugins** group.

## What it may read

`magpie.permissions` in `package.json` — here `usage:summary`. magpie refuses
any other read, by the window and again by magpie. No read gives keys, accounts,
sign-ins or request bodies: treat what a page can read as public.

| Read | Gives |
|---|---|
| `usage:summary` | calls, errors, tokens and cost for `today`, `7d` or `30d`, with the top 20 models |
| `providers:list` | each provider's id and name |

## What the page can do

- `magpie.ready`: a promise of the window's theme; a page that does not say it
  within 10 seconds is shown as not answering.
- `magpie.read(name, params)`: a declared read.
- `magpie.options.get()` / `.set(o)`: this plugin's own options, `set` at most
  once a second.
- `magpie.theme`, `magpie.onTheme(fn)`: `{ dark, lang, tokens }`.
- `magpie.openPlugin(name)`: opens an npm package's sheet, installing nothing.

The page runs in a frame sandboxed to scripts alone, in its own origin: no
network (`connect-src 'none'`), no inline script, no forms, no frames, and no
access to the window's storage. Scripts must be files.

## Panels and menu items

The same page can also be a panel inside magpie's own pages (`magpie.panels`,
slots `agents`, `usage`, `settings`, `provider`) and add items to a provider's or
an agent's menu (`magpie.actions`, handled with `magpie.onAction`).

## Develop

```sh
bun test   # the page's reads are declared, and it reaches no network
```

Errors the page does not catch show **This page stopped working** in its place;
the page's own script errors read "Script error." there, so look in the window's
console.

## License

MIT
