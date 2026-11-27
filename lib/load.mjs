// Loading a plugin package the way magpie loads it, and checking the hooks
// that come back.
//
// The community repository's `scripts/check.mjs` does this: it imports the
// entry the way magpie's Bun host does, calls every exported function with a
// stand-in client, and checks the shape of the hooks. This is the part a
// static read of the source cannot do — it catches a plugin whose `auth` hook
// is missing a loader, whose `tool` has no `execute`, or whose `config` gives
// the provider no models.
//
// Everything here is in-process and offline: nothing signs in, nothing sends a
// request, no network is touched. The stand-in client answers what OpenCode's
// `PluginInput` has and magpie does not.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listFiles, providerEntry } from './check.mjs'

/** What magpie hands a plugin: the client's real methods, and the rest empty. */
function standInClient() {
  return {
    app: { log: async () => {} },
    auth: { set: async () => {}, remove: async () => {} },
    tui: { showToast: async () => {} },
    config: { get: async () => ({ data: {} }) },
  }
}

/** The stand-in input magpie's host builds for a plugin function. */
function standInInput(directory) {
  return {
    client: standInClient(),
    project: { id: 'magpie', worktree: directory },
    directory,
    worktree: directory,
    serverUrl: 'http://127.0.0.1:0',
    $: undefined,
    experimental_workspace: undefined,
    magpie: { option: undefined, options: undefined, load: () => {} },
  }
}

/**
 * The problems with what a package's hooks return.
 * @param {object} hooks the plugin's return value
 * @param {string} label the plugin function's name, for messages
 * @returns {string[]}
 */
export function hookProblems(hooks, label) {
  const problems = []
  if (!hooks || typeof hooks !== 'object') {
    problems.push(`${label}: returns no hooks`)
    return problems
  }
  const tools = hooks.tool ? Object.entries(hooks.tool) : []
  if (hooks.tool && !tools.length) problems.push(`${label}: no tools`)
  for (const [name, tool] of tools) {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(name)) problems.push(`${label}: tool name ${name}`)
    if (typeof tool?.execute !== 'function') problems.push(`${label}: ${name} has no execute`)
    if (typeof tool?.description !== 'string' || !tool.description) problems.push(`${label}: ${name} has no description`)
    if (!tool?.args || typeof tool.args !== 'object') problems.push(`${label}: ${name} has no args`)
  }
  // A package that only gives tools needs no sign-in.
  if (!hooks.auth) {
    if (!tools.length && !hooks.config) problems.push(`${label}: no auth hook`)
    return problems
  }
  const auth = hooks.auth
  if (typeof auth.provider !== 'string' || !auth.provider) problems.push(`${label}: auth.provider`)
  if (!Array.isArray(auth.methods) || !auth.methods.length) problems.push(`${label}: auth.methods`)
  for (const method of auth.methods ?? []) {
    if (!['oauth', 'api'].includes(method.type)) problems.push(`${label}: method type ${method.type}`)
    if (method.type === 'oauth' && typeof method.authorize !== 'function') problems.push(`${label}: ${method.label} has no authorize`)
    if (method.type === 'api' && method.authorize !== undefined && typeof method.authorize !== 'function') {
      problems.push(`${label}: ${method.label} has no authorize`)
    }
  }
  // A provider must be able to sign its requests: a loader, unless the
  // package declares no models of its own (a sign-in-only provider, whose
  // models come from the vendor's list) or only gives tools.
  let needsLoader = !tools.length
  let signInOnly = false
  if (hooks.config) {
    const cfg = { provider: {} }
    hooks.config(cfg).catch(() => {})
    const provider = cfg.provider[auth.provider]
    // No models and no npm: the provider serves what the vendor lists.
    signInOnly = Boolean(provider?.models) && !Object.keys(provider.models).length && !provider.npm
    if (provider && !signInOnly) {
      needsLoader = true
      if (!provider.npm || !provider.models || !Object.keys(provider.models).length) {
        problems.push(`${label}: config gives ${auth.provider} no npm or models`)
      }
    }
  }
  if (signInOnly) needsLoader = false
  if ((needsLoader || auth.loader !== undefined) && typeof auth.loader !== 'function') {
    problems.push(`${label}: auth.loader`)
  }
  return problems
}

/** A seat as magpie's gateway gives one to a strategy (`spread.gateway.js`). */
function standInSeats() {
  return [
    { key: 'a', account: true, known: true, learns: false, used: 42, soon: 600_000, pace: 1, weight: 1, resting: false, tokens: 100 },
    { key: 'b', account: false, known: false, learns: true, used: 0, soon: 300_000, pace: 0, weight: 2, resting: false, tokens: 50 },
    { key: 'c', account: true, known: true, learns: false, used: 95, soon: 120_000, pace: 2, weight: 1, resting: true, tokens: 900 },
  ]
}

/**
 * The problems with a routing module's strategies, found by calling them the way
 * magpie's gateway does: each strategy gets 20 ms and must answer with an order
 * of the seats (indexes), or an object with an `order` that does. A throw, a
 * timeout, or anything but a permutation of the seats leaves the pool in its
 * listed order — so a broken strategy is silent at runtime.
 * @param {object} module the imported routing module
 * @param {string} rel the file, for messages
 * @returns {Promise<string[]>}
 */
export async function strategyProblems(module, rel) {
  const problems = []
  const groups = module.strategies
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
    return [`${rel}: exports no strategies object`]
  }
  const seats = standInSeats()
  const pool = { name: 'stand-in' }
  const options = {}
  const names = Object.keys(groups)
  if (!names.length) problems.push(`${rel}: strategies is empty; no routing is listed`)
  for (const group of names) {
    const strategies = groups[group]
    if (!strategies || typeof strategies !== 'object' || Array.isArray(strategies)) {
      // A flat value: the docs' \`{ name: fn }\` shape, which lists no routing.
      problems.push(`${rel}: strategies.${group} is a ${typeof strategies}, not a group of strategies (${names.length === 1 ? 'this is the flat shape magpie does not read' : 'each group holds { name: fn }'})`)
      continue
    }
    const inner = Object.keys(strategies)
    if (!inner.length) problems.push(`${rel}: strategies.${group} is empty`)
    for (const name of inner) {
      const strategy = strategies[name]
      const value = strategy && typeof strategy === 'object' && typeof strategy.order === 'function' ? strategy.order : strategy
      if (typeof value !== 'function') {
        problems.push(`${rel}: strategies.${group}.${name} is not a function or an object with order`)
        continue
      }
      let order
      try {
        order = await withDeadline(() => value.call(strategy, pool, seats, options), 20)
      } catch (error) {
        problems.push(`${rel}: strategies.${group}.${name} threw: ${error?.message ?? error}`)
        continue
      }
      if (order === undefined || order === null) {
        // Returning nothing is how a hook declines; a strategy must answer.
        problems.push(`${rel}: strategies.${group}.${name} returned nothing; magpie tries the seats in their listed order`)
        continue
      }
      const list = Array.isArray(order) ? order : Array.isArray(order.order) ? order.order : null
      if (!list) {
        problems.push(`${rel}: strategies.${group}.${name} must return an order; magpie tries the seats in their listed order`)
        continue
      }
      const sorted = [...list].map(Number).sort((a, b) => a - b)
      const expected = seats.map((_, index) => index)
      if (!list.every((value) => Number.isInteger(Number(value))) || sorted.join() !== expected.join()) {
        problems.push(`${rel}: strategies.${group}.${name} returned ${JSON.stringify(list)}, not a permutation of ${expected.length} seats; magpie treats it as a failure`)
      }
    }
  }
  return problems
}

/** Run a strategy with magpie's 20 ms deadline for it. */
function withDeadline(fn, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`did not answer within ${ms} ms`)), ms)
    Promise.resolve()
      .then(fn)
      .then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
      )
  })
}

/**
 * Import a routing module the way magpie's gateway does and call its
 * strategies with a stand-in pool.
 * @param {string} dir absolute package directory
 * @param {string} rel the module, from package.json
 * @returns {Promise<{ loaded: boolean, problems: string[], kind: string }>}
 */
async function loadRouting(dir, rel) {
  const path = join(dir, rel)
  if (!existsSync(path)) return { loaded: false, problems: [`${rel} does not exist`], kind: 'routing' }
  let module
  try {
    // moejs has no node_modules and no Node APIs, so a module that needs them
    // throws here exactly as it would there.
    module = await import(pathToFileURL(path).href)
  } catch (error) {
    return { loaded: false, problems: [`${rel} threw on import: ${error?.message ?? error}`], kind: 'routing' }
  }
  const problems = await strategyProblems(module, rel)
  if (typeof module.onUsage === 'function') {
    // magpie calls it per request, with 250 ms, and never waits for it.
    try {
      const row = { provider: 'x', model: 'y', ms: 1, ttftMs: 1, status: 200, tokens: 1, cost: 0 }
      await withDeadline(() => module.onUsage(row, {}), 250)
    } catch (error) {
      problems.push(`${rel}: onUsage threw: ${error?.message ?? error}`)
    }
  }
  return { loaded: true, problems, kind: 'routing' }
}

/**
 * Load a package the way magpie's Bun host does and check its hooks.
 *
 * The module is imported in this process, so the package's own top-level code
 * runs. A plugin package is meant to be inert at import time (it is a module
 * of exported functions), and magpie's host is the same: importing it is what
 * loading it means.
 *
 * Only a **provider** package has hooks to check. Middleware, routings, pages,
 * agents and async hooks are modules magpie loads differently — they export
 * their own functions, not a plugin — and a page's `{ id, server }` default
 * export is its host part, not a provider. Checking them as providers is how
 * the community repository's own checker avoided thirty false alarms.
 *
 * @param {string} dir absolute package directory
 * @returns {Promise<{ loaded: boolean, problems: string[], kind: string }>}
 */
export async function loadAndCheck(dir) {
  const problems = []
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return { loaded: false, problems: ['no package.json'], kind: 'none' }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { loaded: false, problems: [`package.json is not JSON: ${error.message}`], kind: 'none' }
  }
  const magpie = pkg.magpie && typeof pkg.magpie === 'object' ? pkg.magpie : {}
  // A routing is its own module, and magpie calls its strategies with a 20 ms
  // deadline and needs an order back: that is checkable by loading it, which a
  // static read cannot do.
  if (magpie.gateway) {
    return loadRouting(dir, magpie.gateway)
  }
  // A package that is only middleware, routing, an agent or async hooks has
  // no provider plugin at all: magpie loads those modules itself.
  const hasEntry = Boolean(pkg.main || pkg.exports)
  if (!hasEntry) return { loaded: true, problems, kind: 'not-a-provider' }
  // A page's host part is `{ id, server }`, and an agent package's entry is a
  // default export: neither is a provider plugin.
  const isPage = Boolean(magpie.page)
  const isAgent = Boolean(magpie.agent)

  const files = listFiles(dir)
  const entry = providerEntry(pkg, files)
  if (!entry) return { loaded: false, problems: ['no entry file'], kind: 'none' }
  const entryPath = join(dir, entry)
  if (!existsSync(entryPath)) return { loaded: false, problems: [`${entry} does not exist`], kind: 'none' }

  let module
  try {
    module = await import(pathToFileURL(entryPath).href)
  } catch (error) {
    return { loaded: false, problems: [`the entry threw on import: ${error?.message ?? error}`], kind: 'none' }
  }

  // magpie calls every exported function as a plugin, plus a default export of
  // { id, server } (OpenCode v1).
  const functions = Object.values(module).filter((value) => typeof value === 'function')
  const v1 = typeof module.default?.server === 'function' ? module.default.server : null
  if (!functions.length && !v1) return { loaded: false, problems: ['exports no plugin function'], kind: 'none' }
  // A page's host part is its `{ id, server }` default export; an agent
  // package's entry is its own default export. Neither is a provider plugin.
  if (isPage || isAgent) return { loaded: true, problems, kind: 'not-a-provider' }
  const kind = 'provider'

  for (const fn of functions) {
    const label = fn.name || 'plugin'
    let hooks
    try {
      hooks = await fn(standInInput(dir))
    } catch (error) {
      problems.push(`${label}: threw when called: ${error?.message ?? error}`)
      continue
    }
    problems.push(...hookProblems(hooks, label))
  }
  return { loaded: true, problems, kind }
}
