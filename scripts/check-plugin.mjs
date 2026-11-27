// The checker as the community repository writes it: load each package the way
// magpie does, then check the hooks that come back.
//
//   node scripts/check-plugin.mjs <dir> [--json] [--load]
//
// `--load` also imports the package and calls its plugin functions with a
// stand-in client — the part a static read cannot do. It runs the package's
// own top-level code in this process (that is what loading a plugin means),
// and never signs in or sends a request.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkPackage, summarize } from '../lib/check.mjs'
import { loadAndCheck } from '../lib/load.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const load = args.includes('--load')
const dir = resolve(args.find((arg) => !arg.startsWith('--')) ?? '.')
if (!existsSync(dir)) {
  console.error(`${dir} does not exist`)
  process.exit(2)
}

const report = checkPackage(dir)
const { fails, warns } = summarize(report)
let loaded = null
// A routing's strategies are checked by importing the module and calling them,
// so a package that already fails static checks still gets that pass: the
// caller asked for the load, and the two checks answer different questions.
if (load) {
  loaded = await loadAndCheck(dir)
  const rule = loaded.kind === 'routing' ? 'routing-load' : 'hooks'
  for (const problem of loaded.problems) report.findings.push({ level: 'fail', rule, message: problem })
}

const failCount = report.findings.filter((f) => f.level === 'fail').length
const warnCount = report.findings.filter((f) => f.level === 'warn').length

if (json) {
  console.log(JSON.stringify({ ...report, fails: failCount, warns: warnCount, loaded }, null, 2))
} else {
  console.log(`${report.dir}`)
  console.log(`kinds: ${report.kinds.length ? report.kinds.join(', ') : '(none)'}`)
  for (const finding of report.findings) {
    console.log(`${finding.level === 'fail' ? '✗' : '!'} ${finding.rule}: ${finding.message}${finding.file ? ` (${finding.file})` : ''}`)
  }
  if (loaded) console.log(loaded.loaded ? '✓ the package loads and its hooks answer' : `✗ the package does not load: ${loaded.problems.join('; ')}`)
  console.log(failCount || warnCount ? `${failCount} fail, ${warnCount} warn` : '✓ no problems found')
}
process.exit(failCount ? 1 : 0)
