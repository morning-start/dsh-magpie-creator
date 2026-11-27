// Loading a package the way magpie loads it, and the hooks that come back.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { hookProblems, loadAndCheck } from '../lib/load.mjs'

const roots = []
function makePackage(files) {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-load-'))
  roots.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8')
  }
  return dir
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

const provider = (hooks) => `export const P = async () => (${hooks})`

describe('a provider that answers', () => {
  test('an API-key sign-in with a loader', async () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-acme-auth', version: '0.1.0', type: 'module', main: './index.mjs' },
      'index.mjs': provider(`{ auth: { provider: "acme", methods: [{ type: "api", label: "Key" }], loader: async () => ({}) } }`),
    })
    const result = await loadAndCheck(dir)
    assert.deepEqual(result.problems, [])
    assert.equal(result.loaded, true)
  })

  test('a provider that declares models needs an npm and a loader', async () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-x-auth', version: '0.1.0', type: 'module', main: './index.mjs' },
      'index.mjs': provider(`{
        auth: { provider: "x", methods: [{ type: "api" }] },
        config: async (cfg) => { cfg.provider.x = { name: "X", npm: "@ai-sdk/openai", models: { m: {} } } },
      }`),
    })
    assert.match((await loadAndCheck(dir)).problems.join(), /auth\.loader/)
  })

  test('a tool needs a description, args and execute', async () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-y-auth', version: '0.1.0', type: 'module', main: './index.mjs' },
      'index.mjs': provider(`{ auth: { provider: "y", methods: [{ type: "api" }], loader: async () => ({}) }, tool: { search: { args: { type: "object" } } } }`),
    })
    const problems = (await loadAndCheck(dir)).problems.join()
    assert.match(problems, /search has no execute/)
    assert.match(problems, /search has no description/)
  })

  test('an oauth method needs an authorize', async () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-z-auth', version: '0.1.0', type: 'module', main: './index.mjs' },
      'index.mjs': provider(`{ auth: { provider: "z", methods: [{ type: "oauth", label: "Sign in" }], loader: async () => ({}) } }`),
    })
    assert.match((await loadAndCheck(dir)).problems.join(), /has no authorize/)
  })

  test('an entry that throws on import is reported, not crashed on', async () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-broken-auth', version: '0.1.0', type: 'module', main: './index.mjs' },
      'index.mjs': 'throw new Error("boom")\n',
    })
    const result = await loadAndCheck(dir)
    assert.equal(result.loaded, false)
    assert.match(result.problems.join(), /threw on import.*boom/)
  })

  test('a plugin that throws when called is reported', async () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-throw-auth', version: '0.1.0', type: 'module', main: './index.mjs' },
      'index.mjs': 'export const P = async () => { throw new Error("nope") }\n',
    })
    assert.match((await loadAndCheck(dir)).problems.join(), /threw when called.*nope/)
  })
})

describe('packages that are not providers', () => {
  test('a middleware is not loaded as a provider', async () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/middleware-x', version: '0.1.0', magpie: { middleware: './x.middleware.js' } },
      'x.middleware.js': 'export function onRequest(body) { return body }\n',
    })
    const result = await loadAndCheck(dir)
    assert.deepEqual(result.problems, [])
    assert.equal(result.kind, 'not-a-provider')
  })

  test('a page with a host part is not a provider either', async () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/page-x', version: '0.1.0', main: './index.mjs', magpie: { page: { title: 'X', file: 'page/index.html' } } },
      'index.mjs': 'export default { id: "x", server: async () => ({}) }\n',
      'page/index.html': '<script src="_magpie/bridge.js"></script>',
    })
    assert.equal((await loadAndCheck(dir)).kind, 'not-a-provider')
  })

  test('an async hooks package is not a provider', async () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/gateway-x', version: '0.1.0', magpie: { hooks: './x.hooks.mjs' } },
      'x.hooks.mjs': 'export async function onRequest(body) { return body }\n',
    })
    assert.equal((await loadAndCheck(dir)).kind, 'not-a-provider')
  })
})

describe('the hook checker on its own', () => {
  test('no hooks at all', () => {
    assert.match(hookProblems(undefined, 'P').join(), /returns no hooks/)
  })

  test('a tool-only plugin needs no sign-in', () => {
    assert.deepEqual(hookProblems({ tool: { a: { description: 'd', args: {}, execute: async () => 1 } } }, 'P'), [])
  })

  test('a sign-in-only provider (no models) needs no loader', () => {
    const hooks = {
      auth: { provider: 'x', methods: [{ type: 'api' }] },
      config: async (cfg) => { cfg.provider.x = { name: 'X', models: {} } },
    }
    assert.deepEqual(hookProblems(hooks, 'P'), [])
  })
})
