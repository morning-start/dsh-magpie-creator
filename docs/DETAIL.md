# Magpie mode

**Magpie** is an agent preset for building magpie plugins. It is a copy of DSH's
Creator mode (the `cordis` preset) plus this bundle's tools and skills, so a
task can inspect the running Harness *and* drive the magpie CLI, a sandbox and
the seven plugin templates.

It patches no shipped preset. The bundle inserts a new row, so Standard, PTC,
Minimal and Creator compose exactly as they did; removing the bundle removes the
row and the mode with it.

## What magpie is

[magpie](https://usemagpie.ai) puts every model a user has — subscriptions,
coding plans, API keys, local models — behind one local gateway and points their
coding agents at it. It runs OpenCode's provider plugins, so a plugin written
for OpenCode works unchanged, and it also runs pi packages that register a
provider.

Its config folder is `~/.config/magpie` (`$XDG_CONFIG_HOME/magpie` when set) and
holds `plugins.json`, `plugins/`, `plugin-auth.json`, `plugins-providers.json`,
`providers.json`, `usage.jsonl` and `settings.json`. Everything a plugin can
change lives there.

## The seven plugin kinds

| Kind | Declared by | Runs in | May |
|---|---|---|---|
| provider | `main` / `exports` | Bun plugin host | network, timers, npm deps, `$` |
| gateway middleware | `magpie.middleware` | moejs in magpie | one file, relative imports, `console.log` |
| routing | `magpie.gateway` + `strategies` | moejs | 20 ms per call |
| tools | `magpie.tools` or a `tool` hook | Bun plugin host | 55 s per call |
| page | `magpie.page` | sandboxed iframe | no network, no inline script |
| agent | `magpie.agent` | moejs | 1 s to load, 1 s to `connect` |
| async hooks | `magpie.hooks` | Bun plugin host | 1 s default, `gatewayTimeoutMs` |

A package may be several kinds at once. A page with a host part is still a page:
`main` alone does not make a provider, which is why `kindsOf` reads the package
name and the module's own hooks before calling it one.

## The tools

| Tool | Read-only? | What it answers |
|---|---|---|
| `magpie_doctor` | yes | where magpie is, its version, whether a gateway serves, the config folder, whether Bun is downloaded, which plugins are installed |
| `magpie_plugin_new` | writes a new folder | scaffolds a package of one kind, then checks it |
| `magpie_plugin_check` | yes | what magpie would refuse to load, and what it would silently do differently; `load: true` also imports the package and calls its plugin functions with a stand-in client |
| `magpie_sandbox` | touches only its own folder | a magpie with its own HOME, config and port |
| `magpie_templates` | yes | the templates, and the runtime each one runs in |
| `magpie_registry_entry` | yes | the `registry.json` entry a package should carry, checked against magpie's own reader |

`magpie_plugin_new` and `scripts/new-plugin.mjs` call the same engine
(`lib/scaffold.mjs`), so both produce the same bytes.

## What the checker knows

`lib/check.mjs` encodes what magpie's documentation says and what its loader
actually does. Each finding is a `fail` (magpie refuses to load, or would
silently do the wrong thing) or a `warn` (it loads, but the author almost
certainly meant something else).

**Manifest**: name is a lowercase npm name; version is semver; the package
declares a kind; a provider has an entry in magpie's own lookup order
(`exports["./server"]`, `main`, `exports["."]`, then `index.ts/tsx/js/mjs/cjs`).

**Provider exports**: magpie calls *every* exported function as a plugin, so a
helper export (`export function signRequest`) makes the package fail to load.
Helpers belong on `export const _internal = { … }`, which the community plugins
already do.

**moejs modules** (middleware, routing, agent): no bare-package imports, no
`require`, no timers, no `fetch`, no `process`, no `Buffer`, no `node:` imports.
A middleware must export at least one of `onRequest`, `onEvent`, `onResponse`,
`onProvider`, `onAccount`, `onUsage`.

**Pages**: `_magpie/bridge.js` must be loaded; no inline `<script>`; every
`src`/`href` must resolve inside the package; `magpie.permissions` may only name
`usage:summary` and `providers:list`; a panel may not fix `html`/`body` height.

**Agents**: `id` uses lower-case letters, digits, `.`, `_` and `-`; it may not
be one of magpie's own agents; `library.mcp` requires `mcpFormat`, and that
format must be one magpie knows.

**Community conventions**: `@magpie-community/` packages are named after their
kind, and carry the `magpie` keyword. A provider package needs `opencode` and
one of `auth`/`plugin`/`provider` in its keywords, or magpie's Plugins search
(which asks npm for `<query> opencode`) cannot find it.

**Cases**: a middleware's `cases.json` and a routing's `strategies.json` are
checked against the shapes the community repository's harness runs, so a package
that moves there keeps its tests.

**Routing strategies**: `strategies` must be **nested groups**
(`{ group: { name: fn } }`) — magpie takes routing names from the groups only, so
the flat `export const strategies = { "fewest-tokens": (pool, seats) => … }` that
the docs' own example shows lists nothing, and the checker fails it. A group name
becomes `<plugin short name>/<group name>`, so a group named after the plugin is
warned as shadowing another plugin of that name.

**An agent's `launch`**: `launch.env` values are exactly `{key}`, `{url}` or
`{v1}` (one path segment may follow the address), and `launch.args` values are
exactly `{config}`; anything else fails. A value with no placeholder at all is a
warning, because it is written into the user's shell as-is. `config`,
`startup.config` and `base` must be `~`, `$VAR` or absolute — a relative path is a
warning, since magpie expands `~` and `$VAR`, not the plugin's folder.

**`magpie.privacyModels`**: `command` is a program on PATH, an absolute path, or a
slashed path inside the package; a package path that is not there fails, and
`args` must be a list of strings.

**What it does not check yet** — rules magpie's docs state that have no rule
here, so "all clear" does not mean these:

- **moejs imports**: only static `from "<bare name>"`, `from "node:…"` and
  `require()` are caught; `import("./dep.js")`, `import type` and other dynamic
  forms pass.
- **Strategy values**: the names and their grouping are verified, but not that a
  value is a function (or an object with `order`) that survives the 20 ms budget.
- **Async hook return values**: a request hook that changes `model`, `stream`,
  client tools or tool choice is rolled back and counted as a failure, and its
  `fetch` must use `ctx.signal`; only the export names are checked.
- **Middleware hook conventions**: `ctx.reject` only works before routing;
  `onAccount` returns `{ skip: true }`; the signatures are not checked.
- **Agent `startup`**: `launch` and `config` are checked; whether `startup`
  writes `keys` and whether its value matches `model` are not.
- **Pages**: permissions are limited to `usage:summary` and `providers:list`;
  `magpie.openPlugin`'s 1.5 s rate limit is not checked.
- **Panels**: `slot` must be one of four and at most eight panels exist; the
  2400 px `<html>` ceiling is only approximated by "no fixed height".
- **`registry.json` `kind`**: `page`, `agent`, `tools`, `middleware` and `hooks`
  are accepted, but whether `providers` and `kind` may coexist is unverified.

The checker is deliberately conservative: run against all 65 packages in the
community repository it reports 22 findings. `reserve`'s `strategies` is flat, so
magpie lists none of its routings — by the documentation that is a real problem.
The other 21 are the pre-existing `keywords` / `community-name` / `page-form` /
`permissions` warnings; the new rules added no false alarms.

> Note: `reserve` matches the shape of the docs' own example. If magpie's loader
> does accept the flat form, that rule should be a `warn` instead — failing it
> rests on the doc's "every `strategies[name]` is a routing named
> `<plugin>/<name>`" being about nested groups.: run against all 65 packages in the
community repository it reports one finding, and that one is a real bug
(`agent-console` references a `session.js` that is not in the package).

### Loading it, not just reading it

`--load` (and `magpie_plugin_check { load: true }`) does what the community
repository's `scripts/check.mjs` does: it imports the entry the way magpie's
Bun host does, calls every exported function with a stand-in client, and checks
the shape of the hooks that come back. That catches what a static read cannot —
a missing `auth.loader`, a tool without an `execute`, a `config` hook that
gives the provider no models, an entry that throws on import.

Only a **provider** package has hooks to check. Middleware, routings, pages,
agents and async hooks are modules magpie loads differently, and a page's
`{ id, server }` default export is its host part, not a plugin. Checking them
as providers is how the first version of this produced thirty false alarms
against real packages.

## The registry list

`registry.json` — the list magpie's Plugins page suggests — is read into typed
fields *as a whole*, so one value of the wrong type (a string for `providers`,
`"true"` for `community`) loses **every** listing, not just its own. `lib/registry.mjs`
holds magpie's reader's rules, and `magpie_registry_entry` builds an entry that
passes them.

| Field | Rule |
|---|---|
| `package` | an npm package name, at most 214 characters |
| `name` | the card's name |
| `providers` | a provider's entry: the ids it signs in to |
| `kind` | every other kind: `middleware`, `hooks`, `agent`, `tools`, `page` |
| `community` | a boolean; community packages write `true` |
| `icon` | an `https://` or `data:image/` URI, or a bundled icon's name |
| `summary` | `{ "en": …, "zh": … }`, both languages required |

A package published from its own repository leaves `community` out: it is then
not in those groups, the search finds it by name, summary or publisher, and its
card shows its npm publisher instead of the community badge.

## The sandbox

`magpie_sandbox` is the only honest way to prove a plugin installs. It points
`HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and
`XDG_STATE_HOME` at a throwaway folder and gives the gateway its own port, so
the sandbox has no plugins, no sign-ins, no providers and no usage. State lives
in `<sandbox>/sandbox.json`, so a sandbox survives between runs.

The child process gets **exactly** that environment, not the caller's: the
community repository's `scripts/try.sh` runs magpie under `env -i` for the same
reason — a variable inherited from the shell can point magpie back at the real
home. Only PATH (and on Windows SystemRoot and the temp variables) are kept.
On Windows magpie takes its home from `USERPROFILE`, so both are set; with only
`HOME` it stops before doing anything.

`magpie plugin` inside the sandbox prints what magpie really loaded — the
provider's models, the middleware's hooks, the tools' names, the page's
permissions, the routings' names. That line is the evidence; anything else is a
guess.

## Publishing

A scaffolded package is a starting point. Getting it listed has four separate
paths, and magpie's rules differ for each:

- **npm**: `magpie plugin add opencode-acme-auth`, `…@0.2.0`,
  `github:owner/repo[#ref]`, `git+https://…`, `owner/repo`, or a folder path
  (loaded in place, nothing installed). Bun installs it with **no install
  scripts**, so a package whose dependencies build in `postinstall` cannot work.
  It comes from the user's configured registry (`~/.npmrc` `registry=`,
  `~/.bunfig.toml` `install.registry`, `NPM_CONFIG_REGISTRY` /
  `BUN_CONFIG_REGISTRY`); `magpie plugin registry <url>` changes it, `default`
  restores it.
- **Links**: `magpie://plugin?name=opencode-acme-auth` opens magpie on the
  package's detail page (README, publisher, Install for the user to press). The
  link installs nothing and accepts npm names only — no version, path, git or URL.
- **Search**: the page asks npm for `<query> opencode`, so keywords must read
  `["opencode", "opencode-plugin", "<vendor>"]`; it also asks for
  `keywords:pi-package <query>` to find pi packages.
- **GitHub**: a repository shows up under Plugins → Discover → unofficial only
  with the `magpie-plugin` topic, and `package.json` at the repository root. If
  it is on npm with `repository` pointing here it installs from npm; otherwise it
  installs **the repository's current code**, so everything it loads must be
  committed — a repository that builds `dist` at publish time will not appear.
  Forks, archived repositories and `magpie-community`'s own are excluded.
  `magpie.name` (one line, ≤80 bytes) and `magpie.summary` (`{en, zh}`, ≤300
  bytes each) replace the repo name and description, and the card marks them as
  the package's own words.
- **Community**: `magpie-community/plugins`, `packages/<name>`, named
  `@magpie-community/opencode-<name>-auth` / `middleware-<name>` /
  `tools-<name>` / `page-<name>` / `agent-<name>`, no runtime dependencies
  unless truly needed; a version bump on `main` publishes, and every magpie
  updates those packages automatically.
- **The list**: `registry.json` is fetched at most every six hours with a
  bundled fallback; `MAGPIE_PLUGIN_MARKET=<url>` swaps the list so an entry can
  be **tested**, and `off` keeps only the bundled copy.

`scripts/release.mjs` automates the checks before these steps. Publishing to npm,
adding the topic, and opening the `registry.json` PR are the user's own clicks.

## The preset copy

`cordis.patch.yml` restates the whole Creator-mode plugin list, because patches
never deep-merge and a preset's `plugins` array is replaced rather than
extended. That copy is at DSH 0.2.2-rc.5. `scripts/check-patch.mjs` compares it
against the installed `@deepseek-ai/dsh-web-app/presets/cordis.patch.yml` and
fails when DSH has rows the copy lacks — otherwise Magpie mode would silently
lose them on upgrade.

Desktop keeps DSH inside `app.asar`, which a plain `node` cannot read. Copy the
file out and pass `--upstream`, or set `DSH_WEB_APP_DIR`.

### A preset that mounts is not a preset that works

The first version of this bundle declared its tools plugin without Cordis's
service injection:

```js
export function apply(ctx) { ctx.tools.register(…) }   // ✗ ctx.tools is undefined
```

The composition was correct — `dsh --profile … --dump-config` showed the row —
and the server started without an error. But the preset's own audit reported
`magpie-tools (dsh-magpie-creator/tools): cannot get property "tools" without
inject`, so `agentPresets/list` returned the preset with `broken` set, and the
mode picker (which offers only healthy presets) silently left it out. The mode
looked absent while every static check passed.

The fix is two exports:

```js
export const name = 'magpie-tools'
export const inject = ['tools']
export function apply(ctx) { ctx.tools.register(…) }
```

`test/tools.test.mjs` asserts both, so the same mistake fails the suite instead
of disappearing into a picker.

**To check a preset really works**, read `agentPresets/list` and require no
`broken` on the row — not the composed config, which cannot see activation:

```js
await fetch('api/agentPresets/list', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'agentPresets/list', payload: { args: {} } }),
})
// { presets: [ … { id: 'magpie', name: 'Magpie mode', order: 5 } ] }   ← no `broken`
```

## Verified

| What | How | Result |
|---|---|---|
| the bundle installs and composes | `dsh_plugin_release` `rehearse` in a sandbox | installed, composed |
| Magpie mode is registered and healthy | `agentPresets/list` on the sandbox | `magpie`, no `broken` |
| the mode is selectable | the new-session picker in the sandbox | "Magpie mode" listed |
| all 5 tools register | `test/tools.test.mjs` against a mock context | 15 tests pass |
| every template kind checks clean | `test/scaffold.test.mjs` | 7 kinds, 0 fail 0 warn |
| the checker agrees with real packages | run against all 65 community packages | 1 finding, a real bug |
| the shipped block matches DSH | `scripts/check-patch.mjs --upstream` | 32 rows, identical |

## Capabilities

The bundle check reports one `security:capabilities` warning, and it is
accurate: this bundle runs commands (it spawns the magpie CLI from
`lib/magpie.mjs`), reads the environment (`MAGPIE`, `PATH`, `XDG_*`, `HOME`),
writes files (`lib/scaffold.mjs` writes a new package, `lib/sandbox.mjs` writes
sandbox state) and, through a template only, opens network connections.

It does not install into the user's magpie (the user presses Install, or runs
`magpie plugin add` themselves), sign in, edit the profile's `package.json`, or
send telemetry. The report attributes "runs commands" to `lib/check.mjs`
because that file calls `RegExp.exec()`; that specific attribution is a
heuristic false positive, though the overall claim holds.

## Known limitations

- The sandbox has no model credentials: a page has to be looked at by the user
  in `magpie web`, and a real request needs a real provider.
- The checks are static. They cannot prove a vendor's sign-in works.
- `magpie_sandbox` shells out to the user's magpie; without magpie installed it
  can only report that.
- The tools are visible in Magpie mode only. To mount them in another preset,
  edit `preset-magpie`'s `plugins` list in `cordis.patch.yml`.
