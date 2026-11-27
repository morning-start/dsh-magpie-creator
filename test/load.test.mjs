// Loading a package the way magpie loads it, and the hooks that come back.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { hookProblems, loadAndCheck } from '../lib/load.mjs'
import { middlewareEntries, readListing } from '../lib/accept.mjs'
import { scanPrivacy } from '../lib/privacy.mjs'

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

describe('a routing\u2019s strategies, called the way magpie calls them', () => {
  const routingPackage = (source) =>
    makePackage({
      'package.json': { name: '@magpie-community/middleware-probe', version: '0.1.0', type: 'module', magpie: { gateway: './probe.gateway.js' } },
      'probe.gateway.js': source,
    })

  test('a nested group that answers with a permutation passes', async () => {
    const dir = routingPackage('export const strategies = { g: { all: (pool, seats) => seats.map((_, i) => i) } }\n')
    const result = await loadAndCheck(dir)
    assert.deepEqual(result.problems, [])
    assert.equal(result.kind, 'routing')
  })

  test('an object with order passes', async () => {
    const dir = routingPackage('export const strategies = { g: { all: { order: (pool, seats) => seats.map((_, i) => i) } } }\n')
    assert.deepEqual((await loadAndCheck(dir)).problems, [])
  })

  test('the flat shape is reported once per strategy', async () => {
    const dir = routingPackage('export const strategies = { a: (pool, seats) => [], b: (pool, seats) => [] }\n')
    const problems = (await loadAndCheck(dir)).problems
    assert.equal(problems.filter((p) => p.includes('not a group of strategies')).length, 2)
  })

  test('a strategy that throws is reported', async () => {
    const dir = routingPackage('export const strategies = { g: { a: () => { throw new Error("boom") } } }\n')
    assert.ok((await loadAndCheck(dir)).problems.some((p) => p.includes('threw: boom')))
  })

  test('a strategy that returns nothing is reported', async () => {
    const dir = routingPackage('export const strategies = { g: { a: () => {} } }\n')
    assert.ok((await loadAndCheck(dir)).problems.some((p) => p.includes('returned nothing')))
  })

  test('a strategy that returns a string is reported', async () => {
    const dir = routingPackage('export const strategies = { g: { a: () => "x" } }\n')
    assert.ok((await loadAndCheck(dir)).problems.some((p) => p.includes('must return an order')))
  })

  test('a strategy that is not a permutation of the seats is reported', async () => {
    const dir = routingPackage('export const strategies = { g: { a: () => [0] } }\n')
    assert.ok((await loadAndCheck(dir)).problems.some((p) => p.includes('not a permutation')))
  })

  test('a strategy that never answers runs into magpie\u2019s 20 ms', async () => {
    const dir = routingPackage('export const strategies = { g: { a: async () => { await new Promise(() => {}) } } }\n')
    assert.ok((await loadAndCheck(dir)).problems.some((p) => p.includes('20 ms')))
  })

  test('an onUsage that throws is reported', async () => {
    const dir = routingPackage('export const strategies = { g: { all: (pool, seats) => seats.map((_, i) => i) } }\nexport function onUsage() { throw new Error("usage") }\n')
    assert.ok((await loadAndCheck(dir)).problems.some((p) => p.includes('onUsage threw: usage')))
  })
})

describe('reading what magpie plugin --json says', () => {
  const listing = {
    loaded: null,
    middleware: {
      'C:\\work\\guard': { hooks: ['onRequest', 'onEvent'], calls: 0, avgMicros: 0, failures: 0 },
    },
    plugins: [{ spec: 'C:\\work\\guard' }],
    providers: null,
  }

  test('the real shape is one object, not a list', () => {
    const parsed = readListing(JSON.stringify(listing))
    assert.ok(parsed)
    assert.equal(parsed.plugins.length, 1)
  })

  test('a middleware entry carries its hooks', () => {
    const entries = middlewareEntries(listing)
    assert.equal(entries.length, 1)
    assert.deepEqual(entries[0].hooks, ['onRequest', 'onEvent'])
  })

  test('junk around the JSON is tolerated', () => {
    assert.ok(readListing('some warning line\n' + JSON.stringify(listing)))
    assert.equal(readListing('not json at all'), null)
  })

  test('a load error the entry carries is reported', () => {
    const withError = { ...listing, middleware: { 'C:\\work\\guard': { hooks: [], failures: 1, error: 'SyntaxError: x' } } }
    assert.equal(middlewareEntries(withError)[0].loadError, 'SyntaxError: x')
  })
})

describe('the privacy scan', () => {
  const BS = String.fromCharCode(92)
  const NL = String.fromCharCode(10)
  const packageWith = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'privacy-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.0', files: Object.keys(files) }))
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(dir, rel), body)
    return dir
  }

  test('a home path is a failure', () => {
    const line = ['const home = "C:', 'Users', 'alice', 'work"'].join(BS) + NL
    const found = scanPrivacy(packageWith({ 'a.mjs': line })).findings
    assert.equal(found.length, 1)
    assert.equal(found[0].rule, 'home-path')
    assert.equal(found[0].level, 'fail')
  })

  test('a placeholder path and a generic path are not', () => {
    const body = [
      ['const a = "C:', 'Users', '<you>', 'x"'].join(BS) + NL,
      'const b = "~/.config/magpie"' + NL,
      ['const c = "C:', 'Program Files', 'x"'].join(BS) + NL,
    ].join('')
    assert.deepEqual(scanPrivacy(packageWith({ 'a.mjs': body })).findings, [])
  })

  test('a token is a failure, and the report masks it', () => {
    const secret = 'sk-' + 'A'.repeat(24)
    const found = scanPrivacy(packageWith({ 'a.mjs': 'const key = "' + secret + '"' + NL })).findings
    assert.equal(found[0].rule, 'credential')
    assert.ok(!found[0].text.includes('A'.repeat(24)), 'the report must not repeat the secret')
  })

  test('an author email is a warning', () => {
    const found = scanPrivacy(packageWith({ 'README.md': 'contact someone@example.com' + NL }), { authorEmails: ['someone@example.com'] }).findings
    assert.equal(found.length, 1)
    assert.equal(found[0].level, 'warn')
  })

  test('an email that is not the author is left alone', () => {
    const dir = packageWith({ 'README.md': 'contact someone@example.com' + NL })
    assert.deepEqual(scanPrivacy(dir, { authorEmails: ['other@example.com'] }).findings, [])
  })
})
