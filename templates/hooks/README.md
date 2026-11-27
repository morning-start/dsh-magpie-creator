# {{title}}

Async gateway request hooks for [magpie](https://usemagpie.ai): {{description}}

They run in magpie's Bun host, once per agent request, before the JS gateway
middleware, for every provider — Codex's own ChatGPT sign-in included. They may
await I/O, which middleware cannot.

## Hooks

| Hook | Gets | Returns |
|---|---|---|
| `onRequest(body, ctx)` | the agent API request object | a replacement body, or nothing |
| `onResponse(reply, ctx)` | the finished reply, best effort | nothing; it cannot change the reply |
| `onSignIn(event, ctx)` | `{ provider, providerName, account, state, endsAt? }` | nothing; told once until the account works again |

`ctx` carries `protocol`, `model`, `stream`, `path`, `agent`, `caller`, `session`,
`cwd`, `query`, `options` and `signal`. `ctx.query` is the latest user text,
without tool results or images. No authorization header is ever passed in.

A request hook cannot turn a request away — a middleware's `ctx.reject` can. A
hook that changes the model, streaming, the client's tools or its tool choice is
rolled back as a failure. Each hook has one second by default; set
`gatewayTimeoutMs` (100–30000) in the plugin's options.

## Use

```sh
magpie plugin add ./{{short}}
magpie plugin options {{short}} '{"prefix":"Project: acme"}'
```

Settings → Plugins shows each hook's calls, latency, failures and outcomes.

## Develop

```sh
bun test
```

## License

MIT
