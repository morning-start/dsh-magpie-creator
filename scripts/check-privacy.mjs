// Scan this repository for what an author forgets to take out before
// publishing: a home folder, an email, a token.
//
//   node scripts/check-privacy.mjs [<repo dir>] [--author <email>]… [--all]
//
// It reads the working tree as it would be published (`package.json`'s `files`
// when it is given), not the git history. A `fail` is a credential or a real
// home path; a `warn` is a plausible smell. Exits 1 on any finding.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPrivacy } from '../lib/privacy.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const root = resolve(args.find((arg) => !arg.startsWith('--') && !isEmail(arg)) ?? resolve(here, '..'))
const emails = []
for (const [index, arg] of args.entries()) {
  if (arg === '--author' && args[index + 1]) emails.push(args[index + 1])
}
// The repository's own committers are the authors whose address must not ship.
if (!emails.length) {
  const log = spawnSync('git', ['log', '--format=%ae%n%ce'], { cwd: root, encoding: 'utf8' })
  for (const line of (log.stdout ?? '').split('\n')) {
    if (isEmail(line.trim()) && !emails.includes(line.trim())) emails.push(line.trim())
  }
}

// Only what would be published: the manifest's `files`, when it has them.
let include
const manifest = join(root, 'package.json')
if (existsSync(manifest) && !args.includes('--all')) {
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    if (Array.isArray(pkg.files) && pkg.files.length) {
      const roots = pkg.files.map((entry) => entry.split('/')[0].replace(/^\.\//, ''))
      include = (rel) => roots.some((first) => rel === first || rel.startsWith(`${first}/`)) || ['package.json', 'README.md', 'LICENSE'].includes(rel)
    }
  } catch {
    // an unreadable manifest is check-project's problem
  }
}

const { findings, scanned, skipped } = scanPrivacy(root, { authorEmails: emails, include })
console.log(`${root}`)
console.log(`authors not to ship: ${emails.length ? emails.map(mask).join(', ') : '(none recorded)'}`)
if (skipped.length) console.log(`left out of the scan: ${skipped.length} file(s) outside the published set`)
console.log(`scanned ${scanned} file(s)`)
if (!findings.length) {
  console.log('✓ no credentials, home paths, or author addresses')
  process.exit(0)
}
for (const finding of findings) {
  const mark = finding.level === 'fail' ? '✗' : '!'
  console.log(`${mark} ${finding.file}:${finding.line}: ${finding.message}: ${finding.text}`)
}
const fails = findings.filter((finding) => finding.level === 'fail').length
console.log(`\n${fails} fail, ${findings.length - fails} warn`)
process.exit(1)

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function mask(email) {
  const [name, domain] = email.split('@')
  return `${name.slice(0, 2)}***@${domain}`
}