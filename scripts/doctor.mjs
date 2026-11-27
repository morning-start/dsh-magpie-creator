#!/usr/bin/env node
// What is on this machine, and what a magpie plugin author needs from it.
//
//   node scripts/doctor.mjs [--json]
//
// Read-only. Installs nothing, changes nothing.
import { doctor } from '../lib/doctor.mjs'

const json = process.argv.includes('--json')
const report = await doctor()
if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`platform: ${report.platform}`)
  console.log(`magpie:   ${report.magpie.path ?? 'not found'}${report.magpie.version ? ` (${report.magpie.version})` : ''}`)
  console.log(`config:   ${report.config}`)
  console.log(`plugins:  ${report.plugins.count} installed`)
  console.log('')
  for (const check of report.checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.id}: ${check.detail}`)
    if (!check.ok && check.fix) console.log(`    → ${check.fix}`)
  }
  console.log('')
  console.log(report.ok ? 'ready to build a plugin' : 'some checks need you first; a folder plugin is still testable in a sandbox')
}
process.exit(report.ok ? 0 : 1)
