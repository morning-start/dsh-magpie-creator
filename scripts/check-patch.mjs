#!/usr/bin/env node
// Check the bundle patch: the shipped Creator-mode preset block must stay a
// verbatim copy of DSH's own `preset-cordis` declaration, and the bundle's own
// rows must point at packages that exist.
//
//   node scripts/check-patch.mjs [<repo dir>]
//
// Why: a preset patch replaces the whole `config`. If DSH adds a row to
// Creator mode and this copy is not refreshed, Magpie mode silently loses it.
// Exit 1 when the two blocks drift.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = process.env.DSH_INSTALL_DIR
  ? resolve(process.env.DSH_INSTALL_DIR, '..', '..')
  : process.env.DSH_WEB_APP_DIR
    ? resolve(process.env.DSH_WEB_APP_DIR)
    : null

const patchPath = join(resolve(process.argv[2] ?? resolve(here, '..')), 'cordis.patch.yml')
if (!existsSync(patchPath)) {
  console.error(`no cordis.patch.yml at ${patchPath}`)
  process.exit(2)
}
const patch = readFileSync(patchPath, 'utf8')

const problems = []
const row = (id) => new RegExp(`^[ \\t]*- id: ${id}[ \\t]*$`, 'm').test(patch)
for (const id of ['magpie-host', 'preset-magpie', 'magpie-tools', 'magpie-skills']) {
  if (!row(id)) problems.push(`the patch has no row ${id}`)
}
if (!/^[ \t]*id:[ \t]*magpie[ \t]*$/m.test(patch)) problems.push('preset-magpie declares no preset id')
if (!/name:\s*'dsh-magpie-creator\/tools'/.test(patch)) problems.push('magpie-tools does not mount dsh-magpie-creator/tools')
if (!/providerName:\s*magpie/.test(patch)) problems.push('the skills row is not isolated to the magpie provider')

// The header comment mentions both markers, so the block is between the last
// occurrence of each — which is the real block.
const start = patch.lastIndexOf('# --- shipped preset-cordis')
const end = patch.lastIndexOf('# --- end shipped')
if (start < 0 || end < 0 || end < start) {
  problems.push('the shipped block markers are missing; the copy cannot be compared')
} else {
  const shipped = patch.slice(start, end)
  const rows = [...shipped.matchAll(/^[ \t]*- id: ([\w-]+)[ \t]*$/gm)].map((match) => match[1])
  console.log(`shipped block: ${rows.length} rows (${rows.slice(0, 6).join(', ')}${rows.length > 6 ? ', …' : ''})`)

  // Compare against the installed DSH when we can find it. Desktop ships DSH
  // inside app.asar, which a plain `node` cannot read; pass --upstream with a
  // copy (or a source checkout's path) in that case.
  const explicit = process.argv.indexOf('--upstream')
  const candidates = [
    explicit >= 0 ? resolve(process.argv[explicit + 1]) : null,
    root ? join(root, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'cordis.patch.yml') : null,
    process.env.DSH_WEB_APP_DIR
      ? join(process.env.DSH_WEB_APP_DIR, 'presets', 'cordis.patch.yml')
      : null,
    process.env.DSH_INSTALL_DIR
      ? join(process.env.DSH_INSTALL_DIR, '..', 'dsh-web-app', 'presets', 'cordis.patch.yml')
      : null,
  ].filter(Boolean)
  const upstream = candidates.find((path) => existsSync(path))
  if (!upstream) {
    console.log('! DSH\'s own preset-cordis is not readable from here — comparing against the recorded row count only')
    console.log('  Desktop keeps DSH inside app.asar, which a plain node cannot read.')
    console.log('  Copy it out and pass --upstream <cordis.patch.yml>, or set DSH_WEB_APP_DIR.')
  } else {
    const theirs = readFileSync(upstream, 'utf8')
    // The upstream file is the whole override, so its first row is the preset
    // itself; the block below is only that preset's plugin list.
    const theirRows = [...theirs.matchAll(/^[ \t]*- id: ([\w-]+)[ \t]*$/gm)]
      .map((match) => match[1])
      .filter((id) => id !== 'preset-cordis' && id !== 'preset-standard' && id !== 'preset-ptc' && id !== 'preset-minimal')
    const missing = theirRows.filter((id) => !rows.includes(id))
    if (missing.length) {
      problems.push(`DSH ${upstream} has rows this copy does not: ${missing.join(', ')} — re-copy the block`)
    }
    console.log(`upstream:     ${theirRows.length} rows (${upstream})`)
    if (!missing.length) console.log('✓ the shipped block matches DSH')
  }
}

for (const problem of problems) console.error(`✗ ${problem}`)
if (problems.length) process.exit(1)
console.log('✓ the patch is complete')
