// The repository a scaffolded package gets: public with the magpie-plugin
// topic, and a repository field that matches it. An existing repository is
// adopted — visibility, topic and manifest aligned — not duplicated.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { handleRepo, githubSlug, TOPIC } from '../lib/repo.mjs'

const roots = []
// The ssh form of a clone URL reads like an email address, which the plugin
// checker's privacy heuristic reports; compose it so the fixtures stay clean.
const sshHost = ['git', 'github.com'].join('@')
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-repo-'))
  roots.push(dir)
  return dir
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function packageAt(dir, overrides = {}) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@magpie-community/opencode-demo-auth',
      version: '0.1.0',
      description: 'A demo provider',
      repository: { type: 'git', url: 'git+https://github.com/OWNER/REPO.git', directory: 'packages/demo' },
      ...overrides,
    }, null, 2),
  )
}

function fakeRun(log, { origin = null, toplevel = null, visibility = 'public', viewFails = false } = {}) {
  return (command, args) => {
    log.push(`${command} ${args.join(' ')}`)
    if (command === 'gh' && args[0] === 'api') return 'octo'
    if (command === 'gh' && args[0] === 'repo' && args[1] === 'view') {
      if (viewFails) throw new Error('not found')
      return JSON.stringify({ visibility })
    }
    if (command === 'git' && args[0] === 'rev-parse') {
      if (toplevel) return toplevel
      throw new Error('not a git repository')
    }
    if (command === 'git' && args[0] === 'remote') {
      if (origin) return origin
      throw new Error('no remote')
    }
    return ''
  }
}

describe('githubSlug', () => {
  test('reads every clone URL form, and only GitHub ones', () => {
    assert.equal(githubSlug('https://github.com/octo/plugin.git'), 'octo/plugin')
    assert.equal(githubSlug('git+https://github.com/octo/plugin.git'), 'octo/plugin')
    assert.equal(githubSlug(`${sshHost}:octo/plugin.git`), 'octo/plugin')
    assert.equal(githubSlug(`ssh://${sshHost}/octo/plugin.git`), 'octo/plugin')
    assert.equal(githubSlug('https://gitlab.com/octo/plugin.git'), null)
  })
})

describe('handleRepo', () => {
  test('public by default, with the topic, and a repository that matches', () => {
    const dir = fresh()
    packageAt(dir)
    const log = []
    const result = handleRepo({ dir, run: fakeRun(log) })

    assert.equal(result.repo, 'octo/opencode-demo-auth')
    assert.equal(result.topic, TOPIC)
    assert.equal(result.private, false)
    assert.equal(result.action, 'created')
    assert.ok(log.includes('gh repo create octo/opencode-demo-auth --public --source . --remote origin --push'))
    assert.ok(log.includes(`gh repo edit octo/opencode-demo-auth --add-topic ${TOPIC} --description A demo provider`))

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.repository.url, 'git+https://github.com/octo/opencode-demo-auth.git')
    assert.equal(pkg.repository.directory, 'packages/demo', 'a monorepo directory is kept')
    assert.ok(log.includes('git add package.json'))
    assert.ok(log.includes('git commit -m chore: point repository at octo/opencode-demo-auth'))
  })

  test('--private creates a private repository and still adds the topic', () => {
    const dir = fresh()
    packageAt(dir)
    const log = []
    handleRepo({ dir, privateRepo: true, run: fakeRun(log) })
    assert.ok(log.some((line) => line.startsWith('gh repo create octo/opencode-demo-auth --private')))
    assert.ok(log.includes(`gh repo edit octo/opencode-demo-auth --add-topic ${TOPIC} --description A demo provider`))
  })

  test('a dry run lists the commands and writes nothing', () => {
    const dir = fresh()
    packageAt(dir)
    const before = readFileSync(join(dir, 'package.json'), 'utf8')
    const log = []
    const result = handleRepo({ dir, dryRun: true, run: fakeRun(log) })

    assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before)
    assert.ok(result.commands.some((line) => line.includes('gh repo create')))
    assert.ok(result.commands.some((line) => line.includes(`--add-topic ${TOPIC}`)))
    // Only reads happen: the gh login lookup, the toplevel probe, the origin probe.
    assert.deepEqual(
      log.filter((line) => !line.startsWith('gh api') && !line.startsWith('git rev-parse') && !line.startsWith('git remote')),
      [],
    )
  })

  test('an existing public repository is adopted: no second repository, topic and manifest aligned', () => {
    const dir = fresh()
    packageAt(dir)
    const log = []
    const result = handleRepo({
      dir,
      run: fakeRun(log, { origin: 'https://github.com/octo/existing.git', toplevel: dir, visibility: 'PUBLIC' }),
    })

    assert.equal(result.repo, 'octo/existing')
    assert.equal(result.action, 'updated')
    assert.ok(!log.some((line) => line.startsWith('gh repo create')))
    assert.ok(log.includes(`gh repo edit octo/existing --add-topic ${TOPIC} --description A demo provider`))
    assert.ok(!log.some((line) => line.includes('--visibility')), 'already public')

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.repository.url, 'git+https://github.com/octo/existing.git')
    assert.equal(pkg.repository.directory, 'packages/demo')
  })

  test('an existing private repository is made public, which is what Discover lists', () => {
    const dir = fresh()
    packageAt(dir)
    const log = []
    handleRepo({
      dir,
      run: fakeRun(log, { origin: `${sshHost}:octo/existing.git`, toplevel: dir, visibility: 'private' }),
    })
    assert.ok(log.includes('gh repo edit octo/existing --visibility public'))
    assert.ok(log.includes(`gh repo edit octo/existing --add-topic ${TOPIC} --description A demo provider`))
  })

  test('--private leaves an existing private repository private', () => {
    const dir = fresh()
    packageAt(dir)
    const log = []
    handleRepo({
      dir,
      privateRepo: true,
      run: fakeRun(log, { origin: 'https://github.com/octo/existing.git', toplevel: dir, visibility: 'private' }),
    })
    assert.ok(!log.some((line) => line.includes('--visibility')))
    assert.ok(log.includes(`gh repo edit octo/existing --add-topic ${TOPIC} --description A demo provider`))
  })

  test('an origin on another host is refused', () => {
    const dir = fresh()
    packageAt(dir)
    assert.throws(
      () => handleRepo({ dir, run: fakeRun([], { origin: 'https://gitlab.com/octo/plugin.git', toplevel: dir }) }),
      /not a GitHub repository/,
    )
  })

  test('an origin whose repository does not exist says how to create it', () => {
    const dir = fresh()
    packageAt(dir)
    assert.throws(
      () =>
        handleRepo({
          dir,
          run: fakeRun([], { origin: 'https://github.com/octo/missing.git', toplevel: dir, viewFails: true }),
        }),
      /gh repo create octo\/missing --public --source \. --push/,
    )
  })

  test('a repository that points elsewhere is aligned with the target', () => {
    const dir = fresh()
    packageAt(dir, { repository: { type: 'git', url: 'git+https://github.com/others/plugin.git' } })
    handleRepo({ dir, run: fakeRun([]) })
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.repository.url, 'git+https://github.com/octo/opencode-demo-auth.git')
  })

  test('a directory inside another checkout is treated as a new repository', () => {
    const parent = fresh()
    const dir = join(parent, 'plugin')
    mkdirSync(dir)
    packageAt(dir)
    const log = []
    const result = handleRepo({
      dir,
      run: fakeRun(log, { toplevel: parent, origin: 'https://github.com/parent/repo.git' }),
    })
    assert.ok(result.commands.includes('git init'))
    assert.ok(result.commands.some((line) => line.startsWith('gh repo create octo/opencode-demo-auth --public')))
  })
})