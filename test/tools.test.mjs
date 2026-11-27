// The tools as DSH mounts them: `apply(ctx)` on a preset-scoped context
// registers each tool, and a call returns the text the model sees.
//
// Nothing here touches the user's magpie: the sandbox actions that would are
// exercised through their guards (a missing sandbox, a missing confirm).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../tools/index.js'

// The first version of this plugin forgot `inject`, and Cordis reported the
// whole Magpie preset broken ("cannot get property \"tools\" without inject"),
// so the mode silently never appeared in the picker. It must stay declared.
test('the plugin declares the Host service it reads', () => {
  assert.deepEqual(inject, ['tools'])
  assert.equal(name, 'magpie-tools')
})

const registered = new Map()
apply({
  tools: {
    register(definition) {
      assert.equal(registered.has(definition.name), false, `${definition.name} registered twice`)
      registered.set(definition.name, definition)
    },
  },
})

const dirs = []
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-tools-'))
  dirs.push(dir)
  return dir
}
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const call = (name, args, exec = {}) => registered.get(name).execute(args, exec)
const render = (name, value) => registered.get(name).output.render({}, value)[0].text

describe('the tools are registered', () => {
  test('all seven, each with a description and a renderer', () => {
    assert.deepEqual([...registered.keys()].sort(), [
      'magpie_doctor',
      'magpie_plugin_accept',
      'magpie_plugin_check',
      'magpie_plugin_new',
      'magpie_registry_entry',
      'magpie_sandbox',
      'magpie_templates',
    ])
    for (const [name, definition] of registered) {
      assert.ok(definition.description.length > 80, `${name} needs a real description`)
      assert.equal(typeof definition.execute, 'function')
      assert.equal(typeof definition.output.render, 'function')
    }
  })

  test('no tool description is longer than DSH accepts', () => {
    for (const [name, definition] of registered) {
      assert.ok(definition.description.length < 4000, `${name} description is ${definition.description.length} chars`)
    }
  })
})

describe('magpie_templates', () => {
  test('lists every kind with its runtime', async () => {
    const text = render('magpie_templates', await call('magpie_templates', {}))
    for (const kind of ['provider', 'middleware', 'routing', 'tools', 'page', 'agent', 'hooks']) {
      assert.match(text, new RegExp(`^${kind} — `, 'm'))
    }
    assert.match(text, /runtime: moejs/)
    assert.match(text, /runtime: bun/)
    assert.match(text, /runtime: browser/)
  })

  test('filters to one kind', async () => {
    const text = await call('magpie_templates', { kind: 'page' })
    assert.match(text, /^page — /m)
    assert.doesNotMatch(text, /^provider — /m)
  })
})

describe('magpie_plugin_new', () => {
  test('scaffolds a package and reports it clean', async () => {
    const parent = temp()
    const text = await call('magpie_plugin_new', {
      kind: 'tools',
      packageName: '@magpie-community/tools-demo',
      dir: join(parent, 'demo'),
      title: 'Demo',
      description: 'A demo tool',
    })
    assert.match(text, /created tools plugin at/)
    assert.match(text, /0 fail, 0 warn/)
    assert.match(text, /next: fill in the TODO parts/)
  })

  test('refuses a directory it did not create', async () => {
    const dir = temp()
    await call('magpie_plugin_new', {
      kind: 'tools', packageName: 'tools-a', dir, description: 'a',
    })
    await assert.rejects(
      call('magpie_plugin_new', { kind: 'tools', packageName: 'tools-a', dir, description: 'a' }),
      /not empty/,
    )
  })

  test('refuses an empty package name', async () => {
    await assert.rejects(call('magpie_plugin_new', { packageName: '  ' }), /packageName is required/)
  })

  test('takes the kind from the package name when not given', async () => {
    const text = await call('magpie_plugin_new', {
      packageName: '@magpie-community/page-notes', dir: join(temp(), 'notes'), description: 'n',
    })
    assert.match(text, /created page plugin at/)
    assert.match(text, /kinds: page/)
  })
})

describe('magpie_plugin_check', () => {
  test('reports a package magpie would refuse', async () => {
    const dir = temp()
    await call('magpie_plugin_new', {
      kind: 'middleware', packageName: '@magpie-community/middleware-bad', dir, description: 'b',
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'bad.middleware.js'), 'export function onRequest(body) { fetch("https://x"); return body }\n', 'utf8')
    const text = render('magpie_plugin_check', await call('magpie_plugin_check', { dir }))
    assert.match(text, /✗ middleware-moejs/)
    assert.match(text, /[1-9]\d* fail/)
  })

  test('with load, it also calls the plugin functions', async () => {
    const dir = temp()
    await call('magpie_plugin_new', {
      kind: 'provider', packageName: 'opencode-demo-auth', dir, description: 'd', id: 'demo',
    })
    const text = render('magpie_plugin_check', await call('magpie_plugin_check', { dir, load: true }))
    assert.match(text, /0 fail/)
  })

  test('refuses a directory that does not exist', async () => {
    await assert.rejects(call('magpie_plugin_check', { dir: join(temp(), 'nope-not-here') }), /does not exist/)
  })
})

describe('magpie_registry_entry', () => {
  test('builds an entry magpie reads', async () => {
    const dir = temp()
    await call('magpie_plugin_new', {
      kind: 'tools', packageName: '@magpie-community/tools-demo', dir, description: 'A demo tool',
    })
    const text = await call('magpie_registry_entry', { dir, summaryZh: '演示工具。' })
    assert.match(text, /"package": "@magpie-community\/tools-demo"/)
    assert.match(text, /"kind": "tools"/)
    assert.match(text, /"community": true/)
    assert.match(text, /magpie reads it whole/)
  })

  test('says what is missing when the Chinese line is not given', async () => {
    const dir = temp()
    await call('magpie_plugin_new', {
      kind: 'tools', packageName: '@magpie-community/tools-demo2', dir, description: 'A demo tool',
    })
    const text = await call('magpie_registry_entry', { dir })
    assert.match(text, /no summary\.zh/)
  })
})

describe('magpie_sandbox', () => {
  test('explains how to run magpie inside the sandbox', async () => {
    const name = `smoke-${process.pid}`
    try {
      const text = await call('magpie_sandbox', { action: 'create', name, port: 3999 })
      assert.match(text, /sandbox .* at /)
      assert.match(text, /MAGPIE_ADDR/)
      assert.match(text, /127\.0\.0\.1:3999/)
    } finally {
      await call('magpie_sandbox', { action: 'remove', name, confirm: true })
    }
  })

  test('refuses a name that is not a sandbox name', async () => {
    await assert.rejects(call('magpie_sandbox', { action: 'create', name: 'Bad Name' }), /lower-case/)
  })

  test('refuses remove without confirm', async () => {
    await assert.rejects(call('magpie_sandbox', { action: 'remove', name: 'never-made' }), /confirm: true/)
  })

  test('refuses to act on a sandbox that was never created', async () => {
    await assert.rejects(call('magpie_sandbox', { action: 'list', name: 'never-made' }), /does not exist/)
  })
})

describe('magpie_doctor', () => {
  test('reports this machine without changing it', async () => {
    const text = await call('magpie_doctor', {})
    assert.match(text, /platform: /)
    assert.match(text, /magpie: /)
    assert.match(text, /config: /)
    for (const id of ['magpie', 'gateway', 'config', 'bun', 'node']) {
      assert.match(text, new RegExp(`[✓✗] ${id}: `), `doctor skipped ${id}`)
    }
  })
})
