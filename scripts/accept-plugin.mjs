// Accept a plugin the way the user will: install it into a sandbox of its own
// and read what that magpie says it loaded.
//
//   node scripts/accept-plugin.mjs <dir> [--sandbox <name>] [--port <port>]
//
// Exits 1 when the package would not install, would not load, or reports no
// hook — the three things a package can be wrong about in magpie itself rather
// than in its source.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { acceptPlugin } from '../lib/accept.mjs'

const args = process.argv.slice(2)
const dir = resolve(args.find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg)) ?? '.')
const sandbox = args.includes('--sandbox') ? args[args.indexOf('--sandbox') + 1] : 'accept'
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 3599
if (!existsSync(dir)) {
  console.error(`${dir} does not exist`)
  process.exit(2)
}

const report = await acceptPlugin(dir, { sandbox, port })
for (const check of report.checks) {
  const mark = check.ok === true ? '✓' : check.ok === null ? '?' : '✗'
  console.log(`${mark} ${check.name}: ${check.detail}`)
}
if (report.unproven.length) {
  console.log('')
  console.log('this sandbox cannot prove:')
  for (const line of report.unproven) console.log(`  - ${line}`)
}
console.log(report.failures.length ? `\n${report.failures.length} failure(s)` : '\n✓ magpie accepts this plugin')
process.exit(report.failures.length ? 1 : 0)