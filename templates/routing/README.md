# {{title}}

Routing strategies for [magpie](https://usemagpie.ai): {{description}}

Each strategy shows in every routing picker — a provider's, a pool's, a group's
— as `{{short}}/<name>`, beside magpie's own.

| Routing | Order it gives |
|---|---|
| `{{short}}/most-room` | the account with the most allowance left first; a resting seat last |
| `{{short}}/fill-then-next` | fill each seat up to `ceiling` (80% by default), then the next |

## Use

```sh
magpie plugin add ./{{short}}
magpie group set fast routing={{short}}/most-room
```

## Develop

```sh
bun test   # strategies.json, asked the way the gateway asks
```

A strategy has 20 ms and runs on moejs (one file, no imports from outside the
package, no timers, no `fetch`). One that throws or answers anything but a
permutation of the seats leaves them in their listed order.

## License

MIT
