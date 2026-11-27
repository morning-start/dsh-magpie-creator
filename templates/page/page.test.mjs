// The page's scripts read only what package.json declares, and reach no
// network: the frame's policy is connect-src 'none', and magpie refuses any
// other read. This test reads the page's files and checks both.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

const dir = join(import.meta.dir, 'page')
const pkg = JSON.parse(readFileSync(join(import.meta.dir, 'package.json'), 'utf8'))
const files = readdirSync(dir).filter((name) => /\.(js|html|css)$/.test(name))
const texts = Object.fromEntries(files.map((name) => [name, readFileSync(join(dir, name), 'utf8')]))

test('the page loads the bridge and no inline script', () => {
  const html = texts['index.html']
  expect(html).toContain('_magpie/bridge.js')
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim())
  expect(inline.length).toBe(0)
})

test('every read is declared in magpie.permissions', () => {
  const declared = new Set(pkg.magpie.permissions ?? [])
  const reads = new Set()
  for (const text of Object.values(texts)) {
    for (const match of text.matchAll(/magpie\.read\(\s*['"]([^'"]+)['"]/g)) reads.add(match[1])
  }
  for (const read of reads) expect(declared.has(read)).toBe(true)
})

test('the page reaches no network', () => {
  for (const [name, text] of Object.entries(texts)) {
    expect({ name, network: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(text) }).toEqual({ name, network: false })
  }
})

test('the page says it is ready within the window it has', () => {
  expect(texts['app.js']).toContain('magpie.ready')
})
