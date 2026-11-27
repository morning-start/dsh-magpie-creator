#!/usr/bin/env node
// The whole loop for one plugin: check it, install it into a sandbox, list what
// the sandbox loaded, and optionally sign in and send one request.
//
//   node scripts/try.mjs <plugin dir> [--sandbox <name>] [--login <provider>] [--test <provider>]
//
// Never touches the user's own magpie: everything runs in the sandbox's HOME.
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const argv = process.argv.slice(2)
const dir = resolve(argv.find((arg) => !arg.startsWith('--')) ?? '.')
const flag = (name) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : null
}
const sandbox = flag('sandbox') ?? `try-${basename(dir).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`
const login = flag('login')
const test = flag('test')

const step = (label, args) => {
  console.log(`\n▸ ${label}`)
  const result = spawnSync(process.execPath, [resolve(here, 'sandbox.mjs'), ...args], { stdio: 'inherit' })
  return result.status ?? 1
}

let code = spawnSync(process.execPath, [resolve(here, 'check-plugin.mjs'), dir], { stdio: 'inherit' }).status ?? 1
if (code !== 0) {
  console.error('\nthe package has problems magpie would refuse; fix them first')
  process.exit(code)
}
code = step(`create sandbox ${sandbox}`, ['create', sandbox])
if (code !== 0) process.exit(code)
code = step(`install ${dir} into ${sandbox}`, ['install', sandbox, dir])
if (code !== 0) process.exit(code)
step(`what ${sandbox} loaded`, ['list', sandbox])
if (login) step(`sign in to ${login}`, ['login', sandbox, login])
if (test) step(`one request per API for ${test}`, ['test', sandbox, test])
console.log(`\ndone. The user's own magpie was not touched; sandbox ${sandbox} keeps its state.`)
