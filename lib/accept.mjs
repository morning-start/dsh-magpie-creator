// Accepting a plugin in a sandbox: the one check that proves it installs and
// that magpie loads the thing the author meant.
//
// A static read and `--load` both answer questions about the source. This
// answers questions about magpie: whether `magpie plugin add` takes the package
// as it is, whether `magpie plugin --json` lists it with no load error, and —
// for a middleware — whether magpie reports the hooks it declared. magpie
// writes a load failure into `plugin --json` and prints hook errors as
// `plugin: …`, so a package that loads says nothing at all.
//
// It never touches the user's own magpie: the sandbox gets its own HOME, its
// own config folder and its own gateway port (see lib/sandbox.mjs), and the
// child process inherits exactly those variables, not this one's.
//
// A model request is out of reach here — a sandbox has no provider credentials
// — so this cannot prove that a vendor's sign-in works, or that a middleware
// changes a real request. The report says so rather than implying more.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readSandboxState, sandboxEnv, sandboxPaths, writeSandboxState } from './sandbox.mjs'
import { checkPackage, summarize } from './check.mjs'

/**
 * Run magpie inside a sandbox.
 * @param {ReturnType<typeof sandboxPaths>} paths
 * @param {string[]} args the magpie arguments
 * @param {{ bin?: string, port?: number, timeoutMs?: number }} [options]
 * @returns {{ status: number, stdout: string, stderr: string, ran: boolean }}
 */
export function runSandboxedMagpie(paths, args, { bin = 'magpie', port = 3499, timeoutMs = 120_000 } = {}) {
  const result = spawnSync(bin, args, {
    env: sandboxEnv(paths, { port }),
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ran: result.error === undefined,
  }
}

/**
 * What `magpie plugin --json` says, or null when it said nothing readable.
 * The real shape is one object, not a list:
 *   { loaded, middleware: { <folder>: { hooks, calls, avgMicros, failures } },
 *     plugins: [ { spec } ], providers }
 * so a plugin's hooks are read from `middleware`, keyed by its folder.
 * @param {string} text its stdout
 * @returns {{ loaded: any, middleware: Record<string, any>, plugins: any[], providers: any } | null}
 */
export function readListing(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** The middleware entries a listing reports, each with its hooks and failures. */
export function middlewareEntries(listing) {
  const entries = []
  const middleware = listing?.middleware
  if (middleware && typeof middleware === 'object') {
    for (const [folder, value] of Object.entries(middleware)) {
      entries.push({
        folder,
        hooks: Array.isArray(value?.hooks) ? value.hooks.map(String) : [],
        failures: Number(value?.failures ?? 0),
        calls: Number(value?.calls ?? 0),
        loadError: typeof value?.error === 'string' ? value.error : null,
      })
    }
  }
  return entries
}

/** The `magpie` object from a package.json, or null. */
export function magpieOf(dir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
    return pkg.magpie && typeof pkg.magpie === 'object' ? pkg.magpie : null
  } catch {
    return null
  }
}

/**
 * Accept a package in a sandbox, from checking it to reading what magpie says
 * it loaded.
 * @param {string} dir the package folder
 * @param {{ sandbox?: string, bin?: string, port?: number, keep?: boolean }} [options]
 * @returns {Promise<object>} the report
 */
export async function acceptPlugin(dir, { sandbox = 'accept', bin = 'magpie', port = 3599 } = {}) {
  const root = resolve(dir)
  const report = {
    dir: root,
    sandbox,
    checks: [],
    loaded: null,
    plugins: null,
    hooks: [],
    failures: [],
    unproven: [
      'a vendor sign-in: the sandbox has no credentials',
      'a middleware changing a real request: the sandbox has no provider to send one to',
    ],
  }
  const pass = (name, detail) => report.checks.push({ name, ok: true, detail })
  const stop = (name, detail) => {
    report.checks.push({ name, ok: false, detail })
    report.failures.push(`${name}: ${detail}`)
  }

  if (!existsSync(root)) {
    stop('the package', `${root} does not exist`)
    return report
  }
  // 1. The static checks still decide what magpie would refuse to load.
  const staticReport = checkPackage(root)
  const { fails } = summarize(staticReport)
  if (fails) {
    const rules = staticReport.findings.filter((f) => f.level === 'fail').map((f) => `${f.rule}: ${f.message}`)
    stop('the package', `magpie would refuse it: ${rules.join('; ')}`)
    return report
  }
  pass('the package', 'no load-blocking finding (run check-plugin --load for the rest)')

  // 2. A sandbox of its own.
  const paths = sandboxPaths(sandbox)
  const state = readSandboxState(paths) ?? writeSandboxState(paths, { name: sandbox, port, createdAt: new Date().toISOString() })
  const sandboxPort = state.port ?? port
  const probe = runSandboxedMagpie(paths, ['plugin', '--json'], { bin, port: sandboxPort })
  if (!probe.ran) {
    stop('magpie', `could not run ${bin}; install magpie to accept a plugin`)
    return report
  }
  if (probe.status !== 0) {
    stop('magpie', `magpie plugin --json exited ${probe.status}: ${(probe.stderr || probe.stdout).trim().slice(0, 400)}`)
    return report
  }
  pass('a sandbox', `${paths.dir}, its own HOME and port ${sandboxPort}`)

  // 3. Install it, the way the user would.
  const added = runSandboxedMagpie(paths, ['plugin', 'add', root], { bin, port: sandboxPort })
  if (added.status !== 0) {
    stop('the install', `magpie plugin add exited ${added.status}: ${(added.stderr || added.stdout).trim().slice(0, 600)}`)
    return report
  }
  pass('the install', 'magpie plugin add took the folder')

  // 4. What magpie says it loaded — the only line that is evidence.
  const listed = runSandboxedMagpie(paths, ['plugin', '--json'], { bin, port: sandboxPort })
  const listing = readListing(listed.stdout)
  if (!listing) {
    stop('the listing', `magpie plugin --json gave nothing readable: ${(listed.stderr || listed.stdout).trim().slice(0, 400)}`)
    return report
  }
  report.plugins = listing.plugins ?? null
  if (!Array.isArray(report.plugins) || !report.plugins.length) {
    stop('the load', 'the sandbox lists no plugin after the install')
    return report
  }
  report.loaded = listing
  pass('the load', `magpie lists ${report.plugins.length} plugin entr${report.plugins.length === 1 ? 'y' : 'ies'}`)

  // 5. For a middleware or routing, magpie names the hooks it will call. That
  // is the check a static read cannot make: it is magpie's own answer.
  const magpie = magpieOf(root)
  if (magpie?.middleware || magpie?.gateway) {
    const entries = middlewareEntries(listing)
    const mine = entries.find((entry) => sameFolder(entry.folder, root)) ?? (entries.length === 1 ? entries[0] : null)
    if (!mine) {
      stop('the hooks', `magpie lists no middleware entry for this folder (it lists ${entries.map((e) => e.folder).join(', ') || 'none'})`)
      return report
    }
    report.hooks = mine.hooks
    if (mine.loadError) {
      stop('the hooks', `magpie reports a load error: ${mine.loadError}`)
      return report
    }
    if (!mine.hooks.length) {
      stop('the hooks', 'magpie reports no hook for this middleware, so it will never be called')
      return report
    }
    pass('the hooks', `magpie will call ${mine.hooks.join(', ')}`)
  }
  return report
}

/** Whether two folder paths name the same place, case and separator aside. */
function sameFolder(a, b) {
  const norm = (value) => resolve(String(value)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/** A listed plugin, described in one line. */
function describePlugin(plugin) {
  const parts = []
  if (plugin.name) parts.push(String(plugin.name))
  if (plugin.kind) parts.push(`(${plugin.kind})`)
  if (Array.isArray(plugin.models) && plugin.models.length) parts.push(`${plugin.models.length} models`)
  if (Array.isArray(plugin.accounts) && plugin.accounts.length) parts.push(`${plugin.accounts.length} accounts`)
  if (Array.isArray(plugin.hooks) && plugin.hooks.length) parts.push(`${plugin.hooks.length} hooks`)
  return parts.join(' ') || 'an entry with no name'
}

/** The hook names magpie lists for an entry, whichever key it uses. */
function hooksFromListed(plugin) {
  for (const key of ['hooks', 'hookNames', 'hook_names']) {
    if (Array.isArray(plugin?.[key])) return plugin[key].map(String)
  }
  return []
}

/** `magpie` from a package.json, for a package the checker already read. */
function readMagpie(dir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
    return pkg.magpie ?? null
  } catch {
    return null
  }
}
