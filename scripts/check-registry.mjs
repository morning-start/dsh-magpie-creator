#!/usr/bin/env node
// Check a registry.json (or the entry a package should carry) against what
// magpie's own reader takes.
//
//   node scripts/check-registry.mjs <registry.json>
//   node scripts/check-registry.mjs <package dir>        # print its entry
//   node scripts/check-registry.mjs <package dir> --write  # print the entry, validated
//
// One wrong type in one entry loses every listing on the Plugins page, so this
// is worth running before a pull request.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkPackage } from '../lib/check.mjs'
import { registryEntry, registryProblems } from '../lib/registry.mjs'

const argv = process.argv.slice(2)
const target = resolve(argv.find((arg) => !arg.startsWith('--')) ?? '.')
const write = argv.includes('--write')

if (!existsSync(target)) {
  console.error(`${target} does not exist`)
  process.exit(2)
}

const asRegistry = statSync(target).isFile()
if (asRegistry) {
  const problems = registryProblems(readFileSync(target, 'utf8'))
  for (const problem of problems) console.error(`✗ ${problem}`)
  console.log(problems.length ? `${problems.length} problem(s)` : '✓ magpie reads it whole')
  process.exit(problems.length ? 1 : 0)
}

const report = checkPackage(target)
const entry = registryEntry(
  JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')),
  report.kinds,
  { summaryZh: process.env.MAGPIE_SUMMARY_ZH ?? '' },
)
const problems = registryProblems(JSON.stringify({ version: 1, plugins: [entry] }))
console.log(JSON.stringify(entry, null, 2))
for (const problem of problems) console.error(`✗ ${problem}`)
if (problems.length) {
  console.error('\nfill in summary.zh (MAGPIE_SUMMARY_ZH) and providers before opening a pull request')
  process.exit(write ? 1 : 0)
}
console.log('\n✓ the entry passes magpie\'s reader; paste it into registry.json')
