#!/usr/bin/env node
// Run magpie inside a sandbox, so the user's own magpie is never touched.
//
//   node scripts/sandbox.mjs create <name> [--port 3499]
//   node scripts/sandbox.mjs install <name> <plugin dir | spec>
//   node scripts/sandbox.mjs list <name>
//   node scripts/sandbox.mjs login <name> <provider>
//   node scripts/sandbox.mjs test <name> <provider>
//   node scripts/sandbox.mjs command <name>
//   node scripts/sandbox.mjs remove <name>
//   node scripts/sandbox.mjs run <name> -- <magpie args…>
//
// A sandbox is a folder with its own HOME, config, cache and gateway port. It
// keeps its state between runs, so the same sandbox serves the same plugin
// until you remove it.
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { locateMagpie, runMagpie } from '../lib/magpie.mjs'
import {
  readSandboxState, sandboxCommand, sandboxEnv, sandboxPaths, writeSandboxState,
} from '../lib/sandbox.mjs'

const argv = process.argv.slice(2)
const [action, name, ...rest] = argv
if (!action || !name) {
  console.error('usage: node scripts/sandbox.mjs <create|install|list|login|test|command|remove|run> <name> [args…]')
  process.exit(2)
}
if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) {
  console.error('a sandbox name is lower-case letters, digits and dashes')
  process.exit(2)
}

const paths = sandboxPaths(name)
const bin = locateMagpie().path
const state = readSandboxState(paths)
const portFlag = argv.indexOf('--port')
const port = state?.port ?? (portFlag >= 0 ? Number(argv[portFlag + 1]) : 3499)

const requireSandbox = () => {
  if (!state) {
    console.error(`sandbox ${name} does not exist; run: node scripts/sandbox.mjs create ${name}`)
    process.exit(2)
  }
}

const run = async (magpieArgs, timeoutMs = 180_000) => {
  if (!bin) {
    console.error('magpie was not found; install it from https://usemagpie.ai or set MAGPIE')
    process.exit(2)
  }
  const result = await runMagpie(magpieArgs, { bin, env: sandboxEnv(paths, { port }), timeoutMs })
  if (result.stdout.trim()) process.stdout.write(result.stdout.trimEnd() + '\n')
  if (result.stderr.trim()) process.stderr.write(result.stderr.trimEnd() + '\n')
  return result.code ?? 1
}

let code = 0
switch (action) {
  case 'create': {
    for (const dir of [paths.home, paths.config, paths.cache, paths.state]) mkdirSync(dir, { recursive: true })
    writeSandboxState(paths, { name, port, created: new Date().toISOString(), plugin: state?.plugin ?? null })
    console.log(`sandbox ${name} at ${paths.dir} (gateway port ${port})`)
    console.log('')
    console.log(sandboxCommand(paths, { bin: bin ?? 'magpie', port, shell: process.platform === 'win32' ? 'pwsh' : 'sh' }))
    break
  }
  case 'install': {
    requireSandbox()
    const target = rest.find((arg) => !arg.startsWith('--'))
    if (!target) {
      console.error('usage: node scripts/sandbox.mjs install <name> <plugin dir | spec>')
      process.exit(2)
    }
    const resolved = target.startsWith('.') || target.includes('/') || target.includes('\\') ? resolve(target) : target
    code = await run(['plugin', 'add', resolved])
    if (code === 0) writeSandboxState(paths, { ...state, plugin: resolved, installedAt: new Date().toISOString() })
    break
  }
  case 'list':
    requireSandbox()
    code = await run(['plugin'])
    break
  case 'login':
    requireSandbox()
    code = await run(['plugin', 'login', rest[0]], 300_000)
    break
  case 'test':
    requireSandbox()
    code = await run(['provider', 'test', rest[0]], 180_000)
    break
  case 'command':
    console.log(sandboxCommand(paths, { bin: bin ?? 'magpie', port, shell: process.platform === 'win32' ? 'pwsh' : 'sh' }))
    break
  case 'status':
    requireSandbox()
    code = await run(['status', '--json'], 30_000)
    break
  case 'remove': {
    rmSync(paths.dir, { recursive: true, force: true })
    console.log(`removed sandbox ${name} (${paths.dir})`)
    break
  }
  case 'run': {
    requireSandbox()
    const dash = argv.indexOf('--')
    const magpieArgs = dash >= 0 ? argv.slice(dash + 1) : rest
    code = await run(magpieArgs)
    break
  }
  default:
    console.error(`unknown action ${action}`)
    process.exit(2)
}
process.exit(code)
