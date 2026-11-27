#!/usr/bin/env node
// Scaffold a magpie plugin package from a template.
//
//   node scripts/new-plugin.mjs --kind page --name @magpie-community/page-notes --dir ./notes
//   node scripts/new-plugin.mjs --config plan.json
//
// The same engine the `magpie_plugin_new` tool calls, so both produce the same
// bytes. Writes files only; installs nothing.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkPackage, summarize } from '../lib/check.mjs'
import { KINDS, kindFromName, scaffold, shortName } from '../lib/scaffold.mjs'

function parseArgs(argv) {
  const out = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      out._.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (key === 'force') {
      out.force = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`)
    out[key] = value
    index += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const plan = args.config ? JSON.parse(readFileSync(resolve(args.config), 'utf8')) : {}
const packageName = args.name ?? args.packageName ?? plan.packageName
if (!packageName) {
  console.error('usage: node scripts/new-plugin.mjs --name <package> [--kind provider|middleware|routing|tools|page|agent|hooks] [--dir <folder>] [--title <title>] [--description <line>] [--id <provider id>] [--base-url <url>] [--force]')
  process.exit(2)
}
const kind = args.kind ?? plan.kind ?? kindFromName(packageName) ?? 'provider'
if (!KINDS[kind]) {
  console.error(`unknown kind ${kind}; one of ${Object.keys(KINDS).join(', ')}`)
  process.exit(2)
}
const target = resolve(args.dir ?? plan.dir ?? shortName(packageName))

const result = scaffold({
  dir: target,
  kind,
  packageName,
  title: args.title ?? plan.title,
  titleZh: args.titleZh ?? plan.titleZh,
  description: args.description ?? plan.description,
  id: args.id ?? plan.id,
  baseUrl: args['base-url'] ?? plan.baseUrl,
  force: Boolean(args.force ?? plan.force),
})

const report = checkPackage(result.dir)
const { fails, warns } = summarize(report)
console.log(`created ${kind} plugin at ${result.dir}`)
console.log(`files: ${result.files.join(', ')}`)
for (const finding of report.findings) {
  console.log(`${finding.level === 'fail' ? '✗' : '!'} ${finding.rule}: ${finding.message}${finding.file ? ` (${finding.file})` : ''}`)
}
console.log(`${fails} fail, ${warns} warn`)
process.exit(fails ? 1 : 0)
