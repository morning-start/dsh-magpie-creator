// Finding and running the user's magpie, and reading what it says about itself.
//
// Everything here is read-only: `runMagpie` starts a CLI process, which starts a
// plugin host of its own, but it never installs, signs in to, or changes
// anything. Commands that would change the user's magpie are the caller's
// decision, never this module's.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Ports magpie listens on when nothing else says otherwise. */
export const DEFAULT_PORTS = [3425]

/** Where the app keeps its config folder, by platform. */
export function configDir({ home = homedir(), env = process.env } = {}) {
  if (env.MAGPIE_CONFIG_DIR) return env.MAGPIE_CONFIG_DIR
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'magpie')
  if (process.platform === 'win32') return join(home, '.config', 'magpie')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'magpie')
  return join(home, '.config', 'magpie')
}

/** Every place a magpie executable is usually installed, most specific first. */
function candidates({ home = homedir(), env = process.env } = {}) {
  const list = []
  if (env.MAGPIE) list.push(env.MAGPIE)
  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    list.push(
      join(local, 'magpie', 'magpie.exe'),
      join(local, 'Programs', 'magpie', 'magpie.exe'),
      join(local, 'magpie', 'magpie.com'),
      join(home, 'scoop', 'shims', 'magpie.exe'),
      join(home, 'scoop', 'apps', 'magpie', 'current', 'magpie.exe'),
    )
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/magpie.app/Contents/MacOS/magpie',
      join(home, 'Applications', 'magpie.app', 'Contents', 'MacOS', 'magpie'),
      '/opt/homebrew/bin/magpie',
      '/usr/local/bin/magpie',
    )
  } else {
    list.push(join(home, '.local', 'bin', 'magpie'), '/usr/local/bin/magpie', '/usr/bin/magpie')
  }
  // A portable build keeps magpie.exe beside its data folder; the user's own
  // PATH entry is found by the bare name last.
  list.push('magpie')
  return list
}

/**
 * Locate the magpie CLI without running anything.
 * @param {{ home?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ path: string, source: 'env' | 'install' | 'path' } | { path: null, source: 'missing', tried: string[] }}
 */
export function locateMagpie(options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const tried = []
  for (const candidate of candidates({ home, env })) {
    tried.push(candidate)
    if (candidate === 'magpie') {
      // Resolve it through PATH ourselves, so a .cmd shim is the only thing
      // that ever needs a shell.
      const onPath = onPathExecutable('magpie', env)
      if (onPath) return { path: onPath, source: 'path' }
      return { path: null, source: 'missing', tried }
    }
    if (existsSync(candidate)) {
      return { path: candidate, source: candidate === env.MAGPIE ? 'env' : 'install' }
    }
  }
  return { path: null, source: 'missing', tried }
}

/** The first executable named `name` on PATH, honouring PATHEXT on Windows. */
function onPathExecutable(name, env = process.env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
  const exts = process.platform === 'win32'
    ? String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = join(dir, name + ext.toLowerCase())
      if (existsSync(file)) return file
      const upper = join(dir, name + ext)
      if (upper !== file && existsSync(upper)) return upper
    }
  }
  return null
}

/**
 * Run the magpie CLI and collect its output.
 * @param {string[]} args
 * @param {{ bin?: string, env?: Record<string, string | undefined>, cwd?: string, timeoutMs?: number, input?: string }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runMagpie(args, options = {}) {
  const bin = options.bin ?? locateMagpie().path
  const timeoutMs = options.timeoutMs ?? 60_000
  return new Promise((resolve) => {
    if (!bin) {
      resolve({ code: null, stdout: '', stderr: 'magpie was not found', timedOut: false })
      return
    }
    let child
    try {
      // A bare `magpie` on Windows is a .cmd shim, which needs a shell; every
      // other path is spawned directly, so no argument is ever re-parsed.
      const needsShell = process.platform === 'win32' && !bin.includes('\\') && !bin.includes('/')
      child = spawn(bin, args, {
        cwd: options.cwd,
        // With `env`, the child gets exactly that environment (no inheritance),
        // which is what a sandbox needs: a variable in the caller's shell must
        // not point magpie back at the real home.
        ...(options.env === undefined ? {} : { env: options.env }),
        shell: needsShell,
        windowsHide: true,
      })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error?.message ?? error), timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: stderr + String(error?.message ?? error), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    } else {
      child.stdin?.end()
    }
  })
}

/** `magpie --version`, or null when magpie is not installed. */
export async function magpieVersion(options = {}) {
  const bin = options.bin ?? locateMagpie().path
  if (!bin) return null
  const result = await runMagpie(['--version'], { ...options, bin, timeoutMs: 20_000 })
  const match = /magpie\s+(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i.exec(result.stdout + result.stderr)
  return match ? match[1] : null
}

/** Parse `key=value` pairs a magpie command prints, for the few we read. */
export function parseKeyValues(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][\w.-]*)\s*[:=]\s*(.+?)\s*$/.exec(line)
    if (match) out[match[1]] = match[2]
  }
  return out
}

/**
 * Ask the running magpie who it is: `magpie status --json`.
 * @returns {Promise<{ running: boolean, url?: string, version?: string, role?: string, pid?: number } | null>}
 */
export async function magpieStatus(options = {}) {
  const bin = options.bin ?? locateMagpie().path
  if (!bin) return null
  const result = await runMagpie(['status', '--json'], { ...options, bin, timeoutMs: 20_000 })
  const start = result.stdout.indexOf('{')
  if (start < 0) return null
  try {
    return JSON.parse(result.stdout.slice(start))
  } catch {
    return null
  }
}

/** The gateway address a running magpie serves, or the default port. */
export async function gatewayUrl(options = {}) {
  const status = await magpieStatus(options)
  if (status?.url) return status.url
  return `http://127.0.0.1:${DEFAULT_PORTS[0]}`
}
