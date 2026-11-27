#!/usr/bin/env node
// Prepare a magpie plugin package for release.
//
//   node scripts/release.mjs <plugin dir> [--summary-zh <line>]
//
// Checks the package, then prints what a release needs: the version, the files
// npm ships, a registry.json entry that passes magpie's own reader, and the
// commands. Writes nothing.
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkPackage, summarize } from '../lib/check.mjs'
import { registryEntry, registryProblems } from '../lib/registry.mjs'

const argv = process.argv.slice(2)
const dir = resolve(argv.find((arg) => !arg.startsWith('--')) ?? '.')
const zhIndex = argv.indexOf('--summary-zh')
const summaryZh = zhIndex >= 0 ? argv[zhIndex + 1] : (process.env.MAGPIE_SUMMARY_ZH ?? '')

const report = checkPackage(dir)
const { fails, warns } = summarize(report)

console.log(`${dir}`)
console.log(`kinds: ${report.kinds.join(', ') || '(none)'}`)
for (const finding of report.findings) {
  console.log(`${finding.level === 'fail' ? '✗' : '!'} ${finding.rule}: ${finding.message}`)
}
console.log(`${fails} fail, ${warns} warn`)
if (fails) {
  console.error('\nfix the fails before releasing')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const shipped = Array.isArray(pkg.files) ? pkg.files : ['(everything not ignored)']
let size = 0
for (const entry of shipped) {
  try {
    const path = join(dir, entry)
    const stat = statSync(path)
    size += stat.isDirectory() ? 0 : stat.size
  } catch {
    console.log(`! files lists ${entry}, which does not exist`)
  }
}
console.log('')
console.log(`name:    ${pkg.name}`)
console.log(`version: ${pkg.version}`)
console.log(`files:   ${shipped.join(', ')}${size ? ` (${Math.round(size / 1024)} KiB)` : ''}`)

const entry = registryEntry(pkg, report.kinds, { summaryZh })
const problems = registryProblems(JSON.stringify({ version: 1, plugins: [entry] }))
console.log('')
console.log('registry.json entry:')
console.log(JSON.stringify(entry, null, 2))
if (problems.length) {
  console.log('')
  for (const problem of problems) console.log(`! ${problem}`)
  console.log('  (fill summary.zh and providers before opening a pull request)')
}

console.log('')
console.log('release:')
if (pkg.name.startsWith('@magpie-community/')) {
  console.log('  bump the version and push to main — publish.yml packs it onto the dist branch and publishes it to npm')
  console.log('  (a new package is listed in magpie as soon as the pull request is merged: it installs from dist, never waiting for npm)')
} else {
  console.log('  npm publish --access public')
  console.log('  tag the repository magpie-plugin so Discover → Unofficial lists it')
}
console.log(`  magpie plugin add ${pkg.name}@${pkg.version}`)
console.log('  magpie plugin update        # what a user runs to move to it')
