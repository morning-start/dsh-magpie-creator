// The release report, run as a command against a package on disk.
//
// Two things it got wrong once, both worth a test: it read npm's `files`
// patterns as paths (so `locale/*.json` was reported as a missing file), and it
// handed a DSH bundle a magpie `registry.json` entry.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'

const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url))
const roots = []

function makePackage(files) {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-release-'))
  roots.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8')
  }
  return dir
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

/** Run the report and return its output and exit code, never throwing. */
function report(dir) {
  try {
    const output = execFileSync(process.execPath, [script, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, output }
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const bundle = (files = {}) => makePackage({
  'package.json': {
    name: 'dsh-demo-bundle',
    version: '1.2.3',
    description: 'A DSH bundle',
    type: 'module',
    main: './index.js',
    files: ['index.js', 'locale/*.json', 'docs'],
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  },
  'index.js': 'export function apply(ctx) { void ctx }\n',
  'cordis.patch.yml': '[]\n',
  'locale/en.json': '{"meta":{"title":"Demo"}}\n',
  'locale/zh.json': '{"meta":{"title":"演示"}}\n',
  'docs/DETAIL.md': '# Detail\n',
  ...files,
})

describe('a DSH bundle', () => {
  test('reports no problem and names how it is installed', () => {
    const { code, output } = report(bundle())
    assert.equal(code, 0)
    assert.match(output, /0 fail, 0 warn/)
    assert.match(output, /this is a DSH bundle, not a magpie plugin/)
    assert.match(output, /dsh plugin add dsh-demo-bundle@1\.2\.3/)
  })

  test('gets no registry.json entry', () => {
    const { output } = report(bundle())
    assert.doesNotMatch(output, /^registry\.json entry:/m)
    assert.doesNotMatch(output, /"providers"/)
  })

  test('does not read a files pattern as a missing path', () => {
    const { output } = report(bundle())
    assert.doesNotMatch(output, /files lists .* which does not exist/)
  })

  test('still reports a files entry that really is missing', () => {
    const dir = bundle()
    const manifestPath = join(dir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, files: ['index.js', 'nowhere'] }, null, 2), 'utf8')
    assert.match(report(dir).output, /files lists nowhere, which does not exist/)
  })
})

describe('a magpie plugin', () => {
  test('still gets its registry.json entry', () => {
    const dir = makePackage({
      'package.json': {
        name: '@magpie-community/tools-demo',
        version: '0.1.0',
        description: 'A demo tool',
        type: 'module',
        main: './index.mjs',
        files: ['index.mjs'],
        keywords: ['magpie'],
        license: 'MIT',
        repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
      },
      'index.mjs': 'export const P = async () => ({ tool: { a: { description: "d", args: {}, execute: async () => 1 } } })\n',
    })
    const { code, output } = report(dir)
    assert.equal(code, 0)
    assert.match(output, /registry\.json entry/)
    assert.match(output, /"package": "@magpie-community\/tools-demo"/)
  })
})
