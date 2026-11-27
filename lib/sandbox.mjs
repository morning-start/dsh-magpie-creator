// A sandbox for a magpie plugin: a magpie of its own that never touches the
// user's real one.
//
// magpie keeps everything it knows in its config folder (plugins.json,
// plugins/, plugin-auth.json, providers.json, usage.jsonl …). Pointing HOME,
// XDG_CONFIG_HOME, XDG_CACHE_HOME and XDG_STATE_HOME at a throwaway folder and
// giving the gateway its own port gives a magpie with no plugins, no sign-ins,
// no providers and no usage — the setup magpie's own documentation calls a
// sandbox (`https://usemagpie.ai/docs/plugins#testing`).
//
// The state file lives in the sandbox folder, so a sandbox survives between
// runs and can be reused for the same plugin.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const STATE_FILE = 'sandbox.json'

/** Where a sandbox keeps its files. */
export function sandboxPaths(name, { root = join(homedir(), '.dsh-magpie-creator', 'sandboxes') } = {}) {
  const dir = resolve(root, name)
  return {
    name,
    dir,
    home: join(dir, 'home'),
    config: join(dir, 'home', '.config'),
    cache: join(dir, 'home', '.cache'),
    state: join(dir, 'home', '.local', 'state'),
    stateFile: join(dir, STATE_FILE),
  }
}

/**
 * The environment a sandboxed magpie runs with.
 *
 * The community repository's `scripts/try.sh` runs magpie under `env -i` for
 * a reason: a variable inherited from the caller's shell can point magpie back
 * at the real home. Only what a process needs to start and reach the network
 * is kept (PATH, and on Windows SystemRoot), and every variable magpie reads
 * for its own files is set to the sandbox.
 *
 * On Windows magpie takes its home from USERPROFILE, not HOME, so both are
 * set; with only HOME it stops before doing anything.
 * @param {ReturnType<typeof sandboxPaths>} paths
 * @param {{ port?: number, extra?: Record<string, string> }} [options]
 * @returns {Record<string, string>}
 */
export function sandboxEnv(paths, { port = 3499, extra = {} } = {}) {
  const keep = {}
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[name] !== undefined) keep[name] = process.env[name]
  }
  return {
    ...keep,
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: paths.config,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    // A portable build or a user's own override must not win over the sandbox.
    MAGPIE_CONFIG_DIR: paths.config,
    MAGPIE_HOME: paths.home,
    MAGPIE_ADDR: `127.0.0.1:${port}`,
    ...extra,
  }
}

/** Read a sandbox's saved state, or null when it was never created. */
export function readSandboxState(paths) {
  if (!existsSync(paths.stateFile)) return null
  try {
    return JSON.parse(readFileSync(paths.stateFile, 'utf8'))
  } catch {
    return null
  }
}

/** Save a sandbox's state. */
export function writeSandboxState(paths, state) {
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  return state
}

/**
 * The shell command that runs magpie inside a sandbox.
 * POSIX shells get a function; PowerShell gets a function too. Both are printed
 * for the user, and both are what the scripts run through `runMagpie` directly.
 */
export function sandboxCommand(paths, { bin = 'magpie', port = 3499, shell = 'sh' } = {}) {
  if (shell === 'pwsh' || shell === 'powershell') {
    return [
      `$env:HOME = '${paths.home}'`,
      `$env:USERPROFILE = '${paths.home}'`,
      `$env:XDG_CONFIG_HOME = '${paths.config}'`,
      `$env:XDG_CACHE_HOME = '${paths.cache}'`,
      `$env:XDG_STATE_HOME = '${paths.state}'`,
      `$env:MAGPIE_ADDR = '127.0.0.1:${port}'`,
      `# then, for example: & '${bin}' plugin add .`,
    ].join('\n')
  }
  return [
    `export HOME='${paths.home}' USERPROFILE='${paths.home}'`,
    `export XDG_CONFIG_HOME='${paths.config}' XDG_CACHE_HOME='${paths.cache}' XDG_STATE_HOME='${paths.state}'`,
    `export MAGPIE_ADDR='127.0.0.1:${port}'`,
    `# then, for example: ${bin} plugin add .`,
  ].join('\n')
}

/** A free-ish port for a new sandbox: the next one after the ones already taken. */
export function nextPort(taken) {
  let port = 3499
  while (taken.includes(port)) port += 1
  return port
}
