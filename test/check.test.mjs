// The checker's own rules, tested against packages that should pass and
// packages that should not. A rule that never fires is as bad as one that
// fires on a good package, so both directions are covered.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPackage, providerEntry, summarize } from '../lib/check.mjs'

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
