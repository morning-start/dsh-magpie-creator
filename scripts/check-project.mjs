#!/usr/bin/env node
// Check this project itself: the bundle manifest, the patch, the skills, the
// tools module, and the templates.
//
//   node scripts/check-project.mjs [<repo dir>]
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv[2] ?? resolve(here, '..'))
const problems = []
const ok = (message) => console.log(`✓ ${message}`)
const fail = (message) => {
  problems.push(message)
  console.error(`✗ ${message}`)
}

// 1. the manifest
let pkg
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  ok(`package.json (${pkg.name}@${pkg.version})`)
} catch (error) {
  fail(`package.json: ${error.message}`)
}
if (pkg) {
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package.json dsh.bundle.patch must be ./cordis.patch.yml')
  else ok('the bundle declares its patch')
  for (const file of ['index.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'locale/en.json', 'locale/zh.json']) {
    if (!existsSync(join(root, file))) fail(`${file} is missing`)
  }
  for (const entry of ['index.js', 'tools/index.js']) {
    if (!existsSync(join(root, entry))) fail(`${entry} is missing`)
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes('templates')) fail('package.json files must ship templates/')
  else ok('the package ships its templates')
  if (pkg.exports?.['./tools'] !== './tools/index.js') fail('package.json must export ./tools')
  else ok('the tools entry is exported')
}

// 2. the patch
const patch = spawnSync(process.execPath, [join(here, 'check-patch.mjs'), root], { encoding: 'utf8' })
process.stdout.write(patch.stdout)
if (patch.stderr) process.stderr.write(patch.stderr)
if (patch.status !== 0) problems.push('cordis.patch.yml drifted')

// 3. the skills
const skills = spawnSync(process.execPath, [join(here, 'check-skills.mjs'), root], { encoding: 'utf8' })
process.stdout.write(skills.stdout)
if (skills.stderr) process.stderr.write(skills.stderr)
if (skills.status !== 0) problems.push('a skill is malformed')

// 4. the modules load
for (const entry of ['index.js', 'tools/index.js', 'lib/index.mjs']) {
  const check = spawnSync(process.execPath, ['--check', join(root, entry)], { encoding: 'utf8' })
  if (check.status !== 0) fail(`${entry}: ${check.stderr.split('\n')[0]}`)
  else ok(`${entry} parses`)
}

// 5. nothing personal ships
const privacy = spawnSync(process.execPath, [join(here, 'check-privacy.mjs'), root], { encoding: 'utf8' })
process.stdout.write(privacy.stdout)
if (privacy.stderr) process.stderr.write(privacy.stderr)
if (privacy.status !== 0) problems.push('the privacy scan found something')

// 6. the tests
const tests = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: root, encoding: 'utf8' })
const summary = /ℹ pass (\d+)\nℹ fail (\d+)/.exec(tests.stdout)
if (!summary) {
  // A swallowed test run is a swallowed failure: show what node said.
  const detail = (tests.stdout || '') + (tests.stderr || '')
  process.stdout.write(detail.split('\n').slice(-25).join('\n'))
  fail('the tests did not run')
}
else if (summary[2] !== '0') fail(`${summary[2]} test(s) failed`)
else ok(`${summary[1]} tests pass`)

console.log('')
if (problems.length) {
  console.error(`${problems.length} problem(s)`)
  process.exit(1)
}
console.log('ready to install')
