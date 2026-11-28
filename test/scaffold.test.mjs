// Every template kind, generated from the same engine the tool uses, must
// check clean and produce the files magpie loads.
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPackage, summarize } from '../lib/check.mjs'
import { KINDS, kindFromName, planFiles, scaffold, shortName } from '../lib/scaffold.mjs'

const roots = []
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-new-'))
  roots.push(dir)
  return dir
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

const NAMES = {
  provider: 'opencode-acme-auth',
  middleware: 'middleware-no-todo',
  routing: 'middleware-reserve',
  tools: 'tools-calc',
  page: 'page-notes',
  agent: 'agent-toy',
  hooks: 'gateway-prefix',
}

describe('the templates', () => {
  for (const kind of Object.keys(KINDS)) {
    test(`${kind}: generated, checked, and complete`, () => {
      const dir = join(fresh(), kind)
      const result = scaffold({
        dir,
        kind,
        packageName: `@magpie-community/${NAMES[kind]}`,
        title: 'Demo',
        titleZh: '演示',
        description: 'A demo plugin',
        id: 'demo',
      })
      assert.ok(result.files.includes('package.json'))
      assert.ok(result.files.includes('README.md'))
      assert.ok(result.files.includes('.github/workflows/publish.yml'), 'every kind ships a release workflow')
      assert.ok(result.files.some((file) => file.endsWith('.test.mjs')), 'every kind ships a test')

      const report = checkPackage(dir)
      const { fails, warns } = summarize(report)
      assert.equal(fails, 0, `fails: ${JSON.stringify(report.findings.filter((f) => f.level === 'fail'))}`)
      assert.equal(warns, 0, `warns: ${JSON.stringify(report.findings.filter((f) => f.level === 'warn'))}`)
      assert.deepEqual(report.kinds, [kind])
    })
  }

  test('the release workflow publishes a tag and refuses a mismatched version', () => {
    const dir = join(fresh(), 'release')
    scaffold({ dir, kind: 'tools', packageName: '@magpie-community/tools-demo', description: 'demo' })
    const workflow = readFileSync(join(dir, '.github/workflows/publish.yml'), 'utf8')
    assert.match(workflow, /tags:\n\s+- 'v\*'/)
    assert.match(workflow, /npm publish --provenance --access public/)
    assert.match(workflow, /GITHUB_REF_NAME#v/)
    assert.match(workflow, /bun test/)
    assert.ok(workflow.includes('npm view "$name" version'), 'a package that is not on npm yet is told to publish by hand')
    assert.doesNotMatch(workflow, /\{\{\w+\}\}/, 'no template placeholder is left unfilled')
  })

  test('the same arguments write the same bytes', () => {
    const a = planFiles({ kind: 'provider', packageName: 'opencode-x-auth', description: 'x' })
    const b = planFiles({ kind: 'provider', packageName: 'opencode-x-auth', description: 'x' })
    assert.deepEqual(a, b)
  })

  test('a non-empty directory is refused without force', () => {
    const dir = fresh()
    scaffold({ dir, kind: 'tools', packageName: 'tools-a', description: 'a' })
    assert.throws(() => scaffold({ dir, kind: 'tools', packageName: 'tools-a', description: 'a' }), /not empty/)
    assert.doesNotThrow(() => scaffold({ dir, kind: 'tools', packageName: 'tools-a', description: 'a', force: true }))
  })

  test('an invalid package name is refused', () => {
    assert.throws(() => scaffold({ dir: join(fresh(), 'x'), kind: 'tools', packageName: 'Tools Bad' }), /lowercase npm name/)
  })

  test('the kind comes from the community prefix', () => {
    assert.equal(kindFromName('@magpie-community/opencode-acme-auth'), 'provider')
    assert.equal(kindFromName('@magpie-community/middleware-x'), 'middleware')
    assert.equal(kindFromName('@magpie-community/tools-x'), 'tools')
    assert.equal(kindFromName('@magpie-community/page-x'), 'page')
    assert.equal(kindFromName('@magpie-community/agent-x'), 'agent')
    assert.equal(kindFromName('@magpie-community/gateway-x'), 'hooks')
    assert.equal(kindFromName('whatever'), null)
  })

  test('the short name is what magpie prefixes tools and routings with', () => {
    assert.equal(shortName('@magpie-community/tools-calc'), 'calc')
    assert.equal(shortName('@magpie-community/middleware-model-map'), 'model-map')
    assert.equal(shortName('@magpie-community/opencode-acme-auth'), 'acme')
  })

  test('the page template loads the bridge and declares its read', () => {
    const dir = join(fresh(), 'page')
    scaffold({ dir, kind: 'page', packageName: '@magpie-community/page-demo', description: 'd' })
    const html = readFileSync(join(dir, 'page/index.html'), 'utf8')
    assert.match(html, /_magpie\/bridge\.js/)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(pkg.magpie.permissions, ['usage:summary'])
    assert.ok(existsSync(join(dir, pkg.magpie.page.file)))
  })

  test('the middleware template ships cases the community harness can run', () => {
    const dir = join(fresh(), 'mw')
    scaffold({ dir, kind: 'middleware', packageName: '@magpie-community/middleware-demo', description: 'd' })
    const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'))
    assert.ok(Array.isArray(cases) && cases.length > 0)
    for (const c of cases) assert.ok(c.name && (c.request || c.events || c.response))
  })
})
