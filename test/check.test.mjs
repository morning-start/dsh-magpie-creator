// The checker's own rules, tested against packages that should pass and
// packages that should not. A rule that never fires is as bad as one that
// fires on a good package, so both directions are covered.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPackage, providerEntry, summarize } from '../lib/check.mjs'
import * as registry from '../lib/registry.mjs'

const roots = []
function makePackage(files) {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-check-'))
  roots.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8')
  }
  return dir
}
const rules = (report, level) => report.findings.filter((f) => !level || f.level === level).map((f) => f.rule)

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('a good provider', () => {
  const dir = makePackage({
    'package.json': {
      name: '@magpie-community/opencode-acme-auth',
      version: '0.1.0',
      description: 'Acme Coding Plan',
      type: 'module',
      main: './index.mjs',
      files: ['index.mjs', 'README.md'],
      keywords: ['magpie', 'opencode', 'opencode-plugin', 'acme'],
      license: 'MIT',
      repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    },
    'index.mjs': 'export const AcmePlugin = async () => ({ auth: { provider: "acme", methods: [] } })\nexport const _internal = {}\n',
    'README.md': '# Acme',
  })
  test('has no findings', () => {
    const report = checkPackage(dir)
    assert.deepEqual(report.findings, [])
    assert.deepEqual(report.kinds, ['provider'])
  })
  test('finds its entry through main', () => {
    const pkg = { main: './index.mjs' }
    assert.equal(providerEntry(pkg, ['index.mjs']), './index.mjs')
  })
})

describe('a good page', () => {
  const dir = makePackage({
    'package.json': {
      name: '@magpie-community/page-notes',
      version: '0.1.0',
      description: 'notes',
      license: 'MIT',
      repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
      magpie: {
        page: { title: 'Notes', titles: { zh: '笔记' }, file: 'page/index.html', icon: 'page/icon.svg' },
        permissions: ['usage:summary'],
      },
    },
    'page/index.html': '<!doctype html><script src="_magpie/bridge.js"></script><link rel="stylesheet" href="style.css"><script src="app.js" defer></script>',
    'page/app.js': 'await magpie.ready\n',
    'page/style.css': 'body { margin: 0 }',
    'page/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  })
  test('has no findings', () => {
    assert.deepEqual(checkPackage(dir).findings, [])
  })
})

describe('what magpie would refuse', () => {
  test('an entry that exports a helper function', () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-x-auth', version: '0.1.0', type: 'module', main: './index.mjs' },
      'index.mjs': 'export function signRequest() {}\nexport const XPlugin = async () => ({})\n',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('exported-helper'))
  })

  test('a middleware that reaches for the network', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/middleware-x', version: '0.1.0', magpie: { middleware: './x.middleware.js' } },
      'x.middleware.js': 'export async function onRequest(body) { await fetch("https://x"); return body }\n',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('middleware-moejs'))
  })

  test('a middleware that imports a bare package', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/middleware-y', version: '0.1.0', magpie: { middleware: './y.middleware.js' } },
      'y.middleware.js': 'import { z } from "zod"\nexport function onRequest(body) { return body }\n',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('middleware-moejs'))
  })

  test('a page without the bridge', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/page-x', version: '0.1.0', magpie: { page: { title: 'X', file: 'page/index.html' }, permissions: ['usage:summary'] } },
      'page/index.html': '<!doctype html><script src="app.js"></script>',
      'page/app.js': '',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('page-bridge'))
  })

  test('a page with an inline script', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/page-y', version: '0.1.0', magpie: { page: { title: 'Y', file: 'page/index.html' }, permissions: ['usage:summary'] } },
      'page/index.html': '<script src="_magpie/bridge.js"></script><script>alert(1)</script>',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('page-inline-script'))
  })

  test('a page that reads something magpie does not offer', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/page-z', version: '0.1.0', magpie: { page: { title: 'Z', file: 'page/index.html' }, permissions: ['usage:detail'] } },
      'page/index.html': '<script src="_magpie/bridge.js"></script>',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('permission'))
  })

  test('an agent whose library.mcp has no mcpFormat', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/agent-x', version: '0.1.0', magpie: { agent: './x.agent.js' } },
      'x.agent.js': 'export const agent = { id: "toy", config: "~/.toy/c.json", model: "model", library: { mcp: "~/.toy/mcp.json" } }\nexport function connect() { return {} }\n',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('agent-mcp-format'))
  })

  test('an agent that takes a built-in id', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/agent-y', version: '0.1.0', magpie: { agent: './y.agent.js' } },
      'y.agent.js': 'export const agent = { id: "codex", config: "~/.codex/config.toml", model: "model" }\nexport function connect() { return {} }\n',
    })
    assert.ok(rules(checkPackage(dir), 'fail').includes('agent-id'))
  })

  test('a package with no kind at all', () => {
    const dir = makePackage({ 'package.json': { name: 'nothing', version: '0.1.0' } })
    assert.ok(rules(checkPackage(dir), 'fail').includes('kind'))
  })

  test('a missing package.json', () => {
    const dir = makePackage({ 'README.md': '# nothing' })
    const report = checkPackage(dir)
    assert.equal(summarize(report).ok, false)
    assert.ok(rules(report, 'fail').includes('manifest'))
  })
})

describe('a package that is several kinds at once', () => {
  test('a page with a host part is a page, not a provider', () => {
    const dir = makePackage({
      'package.json': {
        name: '@magpie-community/page-chat',
        version: '0.1.0',
        main: './index.mjs',
        magpie: { page: { title: 'Chat', file: 'page/index.html' }, permissions: ['usage:summary'] },
      },
      'index.mjs': 'export default { id: "chat", server: async () => ({}) }\n',
      'page/index.html': '<script src="_magpie/bridge.js"></script>',
    })
    assert.deepEqual(checkPackage(dir).kinds, ['page'])
  })

  test('a provider that also gives tools is both', () => {
    const dir = makePackage({
      'package.json': { name: 'opencode-both-auth', version: '0.1.0', main: './index.mjs' },
      'index.mjs': 'export const BothPlugin = async () => ({ auth: { provider: "both", methods: [] }, tool: { ping: { description: "d", args: {}, execute: async () => "pong" } } })\n',
    })
    assert.deepEqual(checkPackage(dir).kinds.sort(), ['provider', 'tools'])
  })
})

describe('routing strategies', () => {
  const routing = (gatewaySource) =>
    makePackage({
      'package.json': { name: '@magpie-community/middleware-spread', version: '0.1.0', magpie: { gateway: './spread.gateway.js' } },
      'spread.gateway.js': gatewaySource,
      'strategies.json': [{ name: 'a case', strategy: 'fewest', seats: [{ key: 'a' }], expect: ['a'] }],
    })

  test('the docs\u2019 flat example is reported, because magpie reads groups', () => {
    const dir = routing('export const strategies = {\n  "fewest-tokens": (pool, seats) => seats.map((_, i) => i),\n}\n')
    assert.ok(rules(checkPackage(dir), 'fail').includes('routing-strategies-flat'))
  })

  test('method shorthand is the same flat shape', () => {
    const dir = routing('export const strategies = {\n  "fewest-tokens"(pool, seats) {\n    return [0]\n  },\n}\n')
    assert.ok(rules(checkPackage(dir), 'fail').includes('routing-strategies-flat'))
  })

  test('nested groups pass', () => {
    const dir = routing('export const strategies = {\n  cheap: {\n    "least-used": (pool, seats) => seats.map((_, i) => i),\n  },\n}\n')
    assert.ok(!rules(checkPackage(dir), 'fail').includes('routing-strategies-flat'))
  })

  test('a strategy named after the plugin would shadow another', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/middleware-spread', version: '0.1.0', magpie: { gateway: './spread.gateway.js' } },
      'spread.gateway.js': 'export const strategies = {\n  spread: {\n    "least-used": (pool, seats) => seats.map((_, i) => i),\n  },\n}\n',
      'strategies.json': [{ name: 'a case', strategy: 'least-used', seats: [{ key: 'a' }], expect: ['a'] }],
    })
    assert.ok(rules(checkPackage(dir), 'warn').includes('routing-strategy-shadow'))
  })
})

describe('an agent\u2019s launch block', () => {
  const agentWith = (launch) =>
    makePackage({
      'package.json': { name: '@magpie-community/agent-toy', version: '0.1.0', magpie: { agent: './toy.agent.js' } },
      'toy.agent.js': `export const agent = {\n  id: 'toy',\n  config: '~/.toy/settings.json',\n  model: 'model',\n  launch: ${launch},\n}\n\nexport function connect({ gateway }) {\n  return { 'api-base': gateway.v1 }\n}\n`,
    })

  test('the documented placeholders pass', () => {
    const dir = agentWith('{ env: { TOY_API_KEY: "{key}", TOY_BASE: "{url}" }, model: "--model", args: { "--settings": "{config}" } }')
    assert.ok(!rules(checkPackage(dir)).some((r) => r === 'agent-launch' || r === 'agent-config'))
  })

  test('an unknown placeholder is reported', () => {
    const dir = agentWith('{ env: { TOY_BASE: "{base}" } }')
    assert.ok(rules(checkPackage(dir), 'fail').includes('agent-launch'))
  })

  test('an env value with no placeholder is reported', () => {
    const dir = agentWith('{ env: { TOY_MODE: "gateway" } }')
    assert.ok(rules(checkPackage(dir), 'warn').includes('agent-launch'))
  })

  test('a relative config path is reported', () => {
    const dir = makePackage({
      'package.json': { name: '@magpie-community/agent-toy2', version: '0.1.0', magpie: { agent: './toy2.agent.js' } },
      'toy2.agent.js': 'export const agent = { id: "toy2", config: "settings.json", model: "model" }\n',
    })
    assert.ok(rules(checkPackage(dir), 'warn').includes('agent-config'))
  })
})

describe('async gateway hooks', () => {
  const hooksPackage = (source) =>
    makePackage({
      'package.json': { name: '@magpie-community/gateway-x', version: '0.1.0', magpie: { hooks: './x.hooks.mjs' } },
      'x.hooks.mjs': source,
    })

  test('named exports of onRequest and onResponse pass', () => {
    const dir = hooksPackage('export async function onRequest(body, ctx) { return undefined }\nexport function onResponse(reply, ctx) {}\n')
    assert.deepEqual(rules(checkPackage(dir)).filter((r) => r.startsWith('hooks')), [])
  })

  test('onSignIn alone is a hooks module, and only warns about onRequest', () => {
    const dir = hooksPackage('export function onSignIn(event, ctx) {}\n')
    assert.deepEqual(rules(checkPackage(dir)).filter((r) => r.startsWith('hooks')), ['hooks-onrequest'])
  })

  test('a re-exported hook is read by the name it publishes', () => {
    // `export { request as onRequest }` publishes the name onRequest, so magpie
    // sees a request hook. The checker reads the name after `as`.
    const dir = hooksPackage('function request(body) { return undefined }\nexport { request as onRequest }\n')
    assert.deepEqual(rules(checkPackage(dir)).filter((r) => r.startsWith('hooks')), [])
  })

  test('an export list naming onRequest counts', () => {
    const dir = hooksPackage('export function onRequest(body) { return undefined }\nexport function onResponse(reply) {}\n')
    assert.deepEqual(rules(checkPackage(dir)).filter((r) => r.startsWith('hooks')), [])
  })

  test('a request hook that changes the model is reported', () => {
    const dir = hooksPackage('export function onRequest(body, ctx) { body.model = "x"; return body }\n')
    assert.ok(rules(checkPackage(dir), 'fail').includes('hooks-request-mutates'))
  })

  test('a request hook that only reads the model is fine', () => {
    const dir = hooksPackage('export function onRequest(body, ctx) { if (body.model === "x") return undefined }\n')
    assert.ok(!rules(checkPackage(dir), 'fail').includes('hooks-request-mutates'))
  })

  test('fetch without ctx.signal is reported', () => {
    const dir = hooksPackage('export async function onRequest(body, ctx) { await fetch("https://x"); return undefined }\n')
    assert.ok(rules(checkPackage(dir), 'warn').includes('hooks-signal'))
  })

  test('fetch with ctx.signal is not reported', () => {
    const dir = hooksPackage('export async function onRequest(body, ctx) { await fetch("https://x", { signal: ctx.signal }); return undefined }\n')
    assert.ok(!rules(checkPackage(dir), 'warn').includes('hooks-signal'))
  })

  test('ctx.report takes one of its codes', () => {
    const ok = hooksPackage('export async function onRequest(body, ctx) { ctx.report("ready", 10) }\n')
    assert.ok(!rules(checkPackage(ok), 'fail').includes('hooks-report'))
    const bad = hooksPackage('export async function onRequest(body, ctx) { ctx.report("done", 10) }\n')
    assert.ok(rules(checkPackage(bad), 'fail').includes('hooks-report'))
  })

  test('onResponse without onRequest is only a warning', () => {
    const dir = hooksPackage('export function onResponse(reply, ctx) {}\n')
    assert.ok(rules(checkPackage(dir), 'warn').includes('hooks-onrequest'))
  })
})

describe('an agent\u2019s startup block', () => {
  const withStartup = (startup) =>
    makePackage({
      'package.json': { name: '@magpie-community/agent-toy3', version: '0.1.0', magpie: { agent: './toy3.agent.js' } },
      'toy3.agent.js': `export const agent = {\n  id: 'toy3',\n  config: '~/.toy3/models.json',\n  startup: ${startup},\n}\n\nexport function connect() { return {} }\n`,
    })

  test('the documented shape passes', () => {
    const dir = withStartup('{ config: "~/.toy3/settings.json", model: "defaultModel", keys: { defaultProvider: "magpie" } }')
    assert.deepEqual(rules(checkPackage(dir)).filter((r) => r.startsWith('agent-startup')), [])
  })

  test('startup without keys is reported', () => {
    const dir = withStartup('{ config: "~/.toy3/settings.json", model: "defaultModel" }')
    assert.ok(rules(checkPackage(dir), 'warn').includes('agent-startup-keys'))
  })
})

describe('registry kind and providers', () => {
  test('kind with providers loses the entry\u2019s meaning', () => {
    const { registryProblems } = registry
    const source = JSON.stringify({
      version: 1,
      plugins: [{ package: 'a', name: 'A', kind: 'middleware', providers: ['x'], summary: { en: 'e', zh: 'z' } }],
    })
    assert.ok(registryProblems(source).some((p) => p.includes('kind') && p.includes('providers')))
  })

  test('a plain provider entry and a plain kind entry pass', () => {
    const source = JSON.stringify({
      version: 1,
      plugins: [
        { package: 'b', name: 'B', providers: ['b'], summary: { en: 'e', zh: 'z' } },
        { package: 'c', name: 'C', kind: 'middleware', summary: { en: 'e', zh: 'z' } },
      ],
    })
    assert.deepEqual(registry.registryProblems(source), [])
  })
})

describe('privacyModels', () => {
  const withPrivacy = (privacy, files = {}) =>
    makePackage({
      'package.json': { name: 'magpie-privacy-x', version: '0.1.0', magpie: { privacyModels: privacy } },
      ...files,
    })

  test('a program on PATH passes', () => {
    assert.ok(!rules(checkPackage(withPrivacy({ command: 'pf-detect', args: ['--quiet'] })), 'fail').some((r) => r.startsWith('privacy')))
  })

  test('a command inside the package must exist', () => {
    const report = checkPackage(withPrivacy({ command: 'bin/detect' }))
    assert.ok(rules(report, 'fail').includes('privacy-command'))
  })

  test('a command inside the package passes when it is there', () => {
    const report = checkPackage(withPrivacy({ command: 'bin/detect' }, { 'bin/detect': '#!/bin/sh\n' }))
    assert.ok(!rules(report).some((r) => r.startsWith('privacy')))
  })

  test('no command at all is reported', () => {
    assert.ok(rules(checkPackage(withPrivacy({ args: [] })), 'fail').includes('privacy-command'))
  })

  test('args must be strings', () => {
    assert.ok(rules(checkPackage(withPrivacy({ command: 'pf-detect', args: ['--n', 3] })), 'fail').includes('privacy-args'))
  })
})
