// What is on this machine, and what a magpie plugin author needs from it.
//
// Read-only. Every check answers "can I do X here, and if not, what does the
// user have to do" — the tool that calls this never installs anything.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configDir, locateMagpie, magpieStatus, magpieVersion, runMagpie } from './magpie.mjs'

/** The version of Bun magpie downloaded for its plugin host, if it did. */
function bundledBun(env = process.env) {
  const home = env.HOME ?? env.USERPROFILE ?? homedir()
  const candidates = [
    join(home, '.cache', 'magpie', 'bun'),
    join(home, '.local', 'share', 'magpie', 'bun'),
    join(home, 'Library', 'Caches', 'magpie', 'bun'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

/** Read the plugins magpie has added, from its config folder. */
export function installedPlugins({ env = process.env } = {}) {
  const file = join(configDir({ env }), 'plugins.json')
  if (!existsSync(file)) return { file, plugins: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { file, plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [] }
  } catch (error) {
    return { file, plugins: [], error: error.message }
  }
}

/** Whether a plugin spec is already added to the user's magpie. */
export function isInstalled(spec, options = {}) {
  const { plugins } = installedPlugins(options)
  const short = (value) => String(value).replace(/@[^/]*$/, '').replace(/^github:/, '')
  return plugins.some((entry) => short(entry.spec) === short(spec))
}

/**
 * Gather the facts a plugin author needs.
 * @param {{ env?: Record<string, string | undefined>, bin?: string }} [options]
 */
export async function doctor(options = {}) {
  const env = options.env ?? process.env
  const located = locateMagpie({ env })
  const version = located.path ? await magpieVersion({ ...options, bin: located.path }) : null
  const status = located.path ? await magpieStatus({ ...options, bin: located.path }) : null
  const config = configDir({ env })
  const installed = installedPlugins({ env })
  const bunCache = bundledBun(env)

  const checks = []
  const add = (id, ok, detail, fix) => checks.push({ id, ok, detail, ...(fix ? { fix } : {}) })

  add('magpie', Boolean(located.path), located.path ? `${located.path}${version ? ` (magpie ${version})` : ''}` : 'magpie was not found',
    'Install magpie from https://usemagpie.ai, or set MAGPIE to its executable.')
  add('gateway', Boolean(status?.running), status?.running
    ? `serving at ${status.url} (${status.role}, pid ${status.pid})`
    : 'no magpie is serving the gateway right now',
    'Start magpie (the app, or `magpie serve`); a plugin folder is still testable from the CLI without it.')
  add('config', existsSync(config), existsSync(config) ? config : `${config} does not exist yet`,
    'Run magpie once; it writes its config folder on first start.')
  add('bun', Boolean(bunCache), bunCache ? `magpie's Bun is at ${bunCache}` : 'magpie has not downloaded Bun yet',
    'Add any plugin once (`magpie plugin add <name>`); magpie downloads Bun the first time it needs it.')
  add('node', true, `node ${process.version}`, null)

  const problems = checks.filter((check) => !check.ok).length
  return {
    platform: `${process.platform} ${process.arch}`,
    magpie: { path: located.path, version, status },
    config,
    plugins: { file: installed.file, count: installed.plugins.length, specs: installed.plugins.map((entry) => entry.spec) },
    checks,
    ok: problems === 0,
  }
}

/** Run a magpie command inside a sandbox and hand back its output. */
export async function sandboxRun(paths, args, { bin, port, timeoutMs = 120_000, env = {} } = {}) {
  const { sandboxEnv } = await import('./sandbox.mjs')
  return runMagpie(args, { bin, env: sandboxEnv(paths, { port, extra: env }), timeoutMs })
}
