#!/usr/bin/env node
// Prepare a magpie plugin package for release.
//
//   node scripts/release.mjs <plugin dir> [--summary-zh <line>]
//
// Checks the package, then prints what a release needs: the version, the files
// npm ships, a registry.json entry that passes magpie's own reader, and the
// commands. Writes nothing.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkPackage, isDshBundle, summarize } from '../lib/check.mjs'
import { registryEntry, registryProblems } from '../lib/registry.mjs'
import { scanPrivacy } from '../lib/privacy.mjs'

const argv = process.argv.slice(2)
const dir = resolve(argv.find((arg) => !arg.startsWith('--')) ?? '.')
const zhIndex = argv.indexOf('--summary-zh')
const summaryZh = zhIndex >= 0 ? argv[zhIndex + 1] : (process.env.MAGPIE_SUMMARY_ZH ?? '')

// A release is permanent, so what ships is scanned before anything else: a
// home path, an email or a token in a published package cannot be recalled.
const shippedRoots = Array.isArray(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).files)
  ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).files.map((entry) => entry.split('/')[0])
  : null
const privacy = scanPrivacy(dir, {
  authorEmails: process.env.MAGPIE_AUTHOR_EMAILS ? process.env.MAGPIE_AUTHOR_EMAILS.split(',') : [],
  include: shippedRoots ? (rel) => shippedRoots.some((first) => rel === first || rel.startsWith(`${first}/`)) || ['package.json', 'README.md', 'LICENSE'].includes(rel) : undefined,
})
for (const finding of privacy.findings) {
  console.log(`${finding.level === 'fail' ? '✗' : '!'} privacy ${finding.rule}: ${finding.file}:${finding.line} ${finding.message}`)
}

const report = checkPackage(dir)
const { fails, warns } = summarize(report)
const privacyFails = privacy.findings.filter((finding) => finding.level === 'fail').length

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
// `files` holds npm's own patterns, not paths: `locale/*.json` and `docs` both
// mean "whatever is there". Summing only what statSync can open reported a
// pattern as a missing file, which is the one thing that list must never do.
function shippedSize(entry) {
  if (!entry.includes('*')) {
    try {
      const stat = statSync(join(dir, entry))
      if (!stat.isDirectory()) return stat.size
      let total = 0
      for (const name of readdirSync(join(dir, entry), { withFileTypes: true })) {
        total += name.isDirectory() ? shippedSize(`${entry}/${name.name}`) : statSync(join(dir, entry, name.name)).size
      }
      return total
    } catch {
      return null
    }
  }
  const slash = entry.lastIndexOf('/')
  const parent = slash < 0 ? '.' : entry.slice(0, slash)
  const suffix = entry.slice(entry.lastIndexOf('*') + 1)
  try {
    let total = 0
    for (const name of readdirSync(join(dir, parent), { withFileTypes: true })) {
      if (name.isDirectory() || !name.name.endsWith(suffix)) continue
      total += statSync(join(dir, parent, name.name)).size
    }
    return total
  } catch {
    return null
  }
}
let size = 0
for (const entry of shipped) {
  const bytes = shippedSize(entry)
  if (bytes === null) console.log(`! files lists ${entry}, which does not exist`)
  else size += bytes
}
console.log('')
console.log(`name:    ${pkg.name}`)
console.log(`version: ${pkg.version}`)
console.log(`files:   ${shipped.join(', ')}${size ? ` (${Math.round(size / 1024)} KiB)` : ''}`)

// A DSH bundle is not a magpie plugin: it belongs in no magpie registry, and
// the entry builder would hand it a `providers` field that means nothing.
if (isDshBundle(pkg)) {
  console.log('')
  console.log('this is a DSH bundle, not a magpie plugin: no registry.json entry, and')
  console.log('magpie has nothing to install. It is published to npm and installed with')
  console.log(`  dsh plugin add ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

const entry = registryEntry(pkg, report.kinds, { summaryZh })
const problems = registryProblems(JSON.stringify({ version: 1, plugins: [entry] }))
if (privacyFails) problems.unshift(`${privacyFails} privacy finding(s): what ships cannot be recalled`)
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
// A scaffolded package ships .github/workflows/publish.yml, so the tag is the
// whole release: the workflow checks the tag against package.json, tests, and
// publishes. Older packages without it still publish by hand.
const hasWorkflow = existsSync(join(dir, '.github', 'workflows', 'publish.yml'))
if (hasWorkflow) {
  console.log('  bump "version" in package.json, commit it, then:')
  console.log(`    git tag v${pkg.version} && git push --follow-tags`)
  console.log('  .github/workflows/publish.yml publishes that tag to npm with provenance')
  if (pkg.version === '0.1.0') {
    console.log('  (0.1.0 is the first version: publish it by hand with an NPM_TOKEN and add the trusted')
    console.log('   publisher first — a package that does not exist yet cannot have one)')
  }
  console.log('  tag the repository magpie-plugin so Discover → Unofficial lists it')
} else if (pkg.name.startsWith('@magpie-community/')) {
  console.log('  bump the version and push to main — publish.yml packs it onto the dist branch and publishes it to npm')
  console.log('  (a new package is listed in magpie as soon as the pull request is merged: it installs from dist, never waiting for npm)')
} else {
  console.log('  npm publish --access public')
  console.log('  tag the repository magpie-plugin so Discover → Unofficial lists it')
}
console.log(`  magpie plugin add ${pkg.name}@${pkg.version}`)
console.log('  magpie plugin update        # what a user runs to move to it')
