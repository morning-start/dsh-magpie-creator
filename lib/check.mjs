// Checking a magpie plugin package the way magpie itself loads it.
//
// Every rule here comes from magpie's own documentation
// (https://usemagpie.ai/docs/plugins) and from what the community repository's
// `scripts/check.mjs` enforces. A finding is `fail` when magpie would refuse to
// load the package or silently do the wrong thing, and `warn` when it loads but
// the author almost certainly meant something else.
//
// Read-only: nothing here writes, installs, or starts a plugin.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { registryProblems, searchableProvider } from './registry.mjs'

/** The package-name prefix each plugin kind uses in the community repository. */
export const KIND_OF = {
  provider: 'opencode-<name>-auth',
  middleware: 'middleware-<name>',
  routing: 'middleware-<name>',
  tools: 'tools-<name>',
  page: 'page-<name>',
  agent: 'agent-<name>',
  hooks: 'gateway-<name>',
}

const ENTRY_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs']
const RESERVED_PROVIDERS = new Set(['google', 'openai', 'anthropic', 'magpie'])
const BUILTIN_AGENTS = new Set([
  'claude', 'cc', 'codex', 'gemini', 'opencode', 'oc', 'mimocode', 'deveco', 'pi', 'goose',
  'cursor', 'zed', 'copilot', 'crush', 'aside', 'dsh', 'omp', 'omo', 'devin', 'hermes',
  'commandcode', 'grok', 'zcode', 'openhanako', 'alma', 'cindy', 'shelley', 'empryo', 'fx',
])
const MCP_FORMATS = new Set([
  'alma', 'antigravity', 'claude', 'cline', 'codex', 'commandcode', 'copilot', 'crush',
  'cursor', 'devin', 'gemini', 'goose', 'grok', 'hermes', 'kimi', 'omp', 'opencode', 'zed',
])
const PANEL_SLOTS = new Set(['agents', 'usage', 'settings', 'provider'])
const REPLACEABLE_PAGES = new Set(['sessions', 'library', 'routing', 'usage'])
const AI_SDK_PACKAGES = new Set([
  '@ai-sdk/anthropic', '@ai-sdk/google-vertex/anthropic', '@ai-sdk/openai', '@ai-sdk/azure',
  '@ai-sdk/google', '@ai-sdk/github-copilot', '@ai-sdk/openai-compatible',
])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const bytes = (text) => Buffer.byteLength(text, 'utf8')

/** Which kinds a package declares, from its `magpie` object and its files. */
export function kindsOf(pkg, files, root = '.') {
  const magpie = isObject(pkg.magpie) ? pkg.magpie : {}
  const kinds = []
  if (magpie.middleware) kinds.push('middleware')
  if (magpie.gateway) kinds.push('routing')
  if (magpie.tools || files.some((f) => /\.tools\.(m?js|ts)$/.test(f))) kinds.push('tools')
  if (magpie.page) kinds.push('page')
  if (magpie.panels) kinds.push('panels')
  if (magpie.agent) kinds.push('agent')
  if (magpie.hooks) kinds.push('hooks')
  if (magpie.privacyModels) kinds.push('privacy')
  // The package name says what it is; a `main` alone does not, because a page
  // with a host part, a package that is only tools and a plugin that is only an
  // agent all have one.
  const byName = kindsFromName(pkg.name)
  if (byName && byName !== 'provider' && !kinds.length) kinds.push(byName)
  if (pkg.main || pkg.exports) kinds.push('provider')
  // A provider whose entry gives tools is a tools package too.
  if (kinds.includes('provider') && !kinds.includes('tools')) {
    const entry = providerEntry(pkg, files)
    try {
      if (entry && /\btool\s*:/.test(readFileSync(join(root, entry), 'utf8'))) kinds.push('tools')
    } catch {
      // an unreadable entry is reported on its own
    }
  }
  if (!kinds.length) {
    if (files.some((f) => /\.middleware\.(m?js|ts)$/.test(f))) kinds.push('middleware')
    if (files.some((f) => /\.gateway\.(m?js|ts)$/.test(f))) kinds.push('routing')
    if (files.some((f) => /\.agent\.(m?js|ts)$/.test(f))) kinds.push('agent')
    if (files.some((f) => /\.hooks\.(m?js|ts)$/.test(f))) kinds.push('hooks')
    if (files.some((f) => ENTRY_FILES.includes(f))) kinds.push('provider')
  }
  // A `main` alone does not make a provider: a page with a host part, a package
  // that is only tools, and a plugin that is only an agent all have one. The
  // package name settles it; otherwise the module's own hooks do.
  if (kinds.includes('provider') && kinds.some((kind) => kind !== 'provider')) {
    const byName = kindsFromName(pkg.name)
    if (byName && byName !== 'provider') return kinds.filter((kind) => kind !== 'provider')
    if (!byName && !hasProviderHooks(root, pkg, files)) return kinds.filter((kind) => kind !== 'provider')
  }
  return kinds
}

/** Whether the package's module really exports a provider plugin. */
function hasProviderHooks(root, pkg, files) {
  const entry = providerEntry(pkg, files)
  if (!entry) return false
  try {
    const source = readFileSync(join(root, entry), 'utf8')
    return /\bauth\s*:/.test(source) || /\bconfig\s*:/.test(source)
  } catch {
    return true
  }
}

/** The plugin kinds a package's name declares, from its community prefix. */
export function kindsFromName(name) {
  const short = String(name ?? '').replace(/^@[^/]+\//, '')
  if (/^opencode-.*-auth$/.test(short)) return 'provider'
  if (/^middleware-/.test(short)) return null // middleware or routing: the files say
  if (/^tools-/.test(short)) return 'tools'
  if (/^page-/.test(short)) return 'page'
  if (/^agent-/.test(short)) return 'agent'
  if (/^gateway-/.test(short)) return 'hooks'
  return null
}

/** The file magpie loads as the provider plugin, in magpie's own order. */
export function providerEntry(pkg, files) {
  const exportsField = pkg.exports
  if (isObject(exportsField)) {
    const server = exportsField['./server']
    if (typeof server === 'string') return server
    if (isObject(server) && typeof server.default === 'string') return server.default
  }
  if (typeof pkg.main === 'string') return pkg.main
  if (typeof exportsField === 'string') return exportsField
  if (isObject(exportsField)) {
    const dot = exportsField['.']
    if (typeof dot === 'string') return dot
    if (isObject(dot) && typeof dot.default === 'string') return dot.default
  }
  return ENTRY_FILES.find((name) => files.includes(name)) ?? null
}

/** Every file in the package, relative and with forward slashes, skipping heavy folders. */
export function listFiles(dir, { depth = 4, prefix = '' } = {}) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'tmp') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (depth > 0) out.push(...listFiles(join(dir, entry.name), { depth: depth - 1, prefix: rel }))
    } else {
      out.push(rel)
    }
  }
  return out
}

/**
 * Check a plugin package.
 * @param {string} dir absolute package directory
 * @returns {{ dir: string, name: string | null, kinds: string[], findings: Array<{ level: 'fail' | 'warn', rule: string, message: string, file?: string }> }}
 */
export function checkPackage(dir) {
  const root = resolve(dir)
  const findings = []
  const fail = (rule, message, file) => findings.push({ level: 'fail', rule, message, ...(file ? { file } : {}) })
  const warn = (rule, message, file) => findings.push({ level: 'warn', rule, message, ...(file ? { file } : {}) })

  const manifestPath = join(root, 'package.json')
  if (!existsSync(manifestPath)) {
    fail('manifest', 'package.json is missing; magpie loads a folder only when it has one')
    return { dir: root, name: null, kinds: [], findings }
  }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail('manifest', `package.json is not valid JSON: ${error.message}`, 'package.json')
    return { dir: root, name: null, kinds: [], findings }
  }

  const files = listFiles(root)
  const kinds = kindsOf(pkg, files, root)

  // --- the manifest magpie reads first -------------------------------------
  if (typeof pkg.name !== 'string' || !/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(pkg.name)) {
    fail('name', 'package.json name must be a lowercase npm name, optionally scoped', 'package.json')
  }
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(pkg.version)) {
    warn('version', 'package.json version should be semver; magpie shows it on the plugin row', 'package.json')
  }
  if (!pkg.description) warn('description', 'package.json description is shown in search and on the card', 'package.json')
  if (pkg.license !== 'MIT' && !pkg.license) warn('license', 'package.json license is shown on the Discover card', 'package.json')
  if (!pkg.repository) warn('repository', 'package.json repository lets magpie install from npm and show the card', 'package.json')
  if (pkg.type !== 'module' && kinds.some((kind) => ['provider', 'tools', 'hooks'].includes(kind))) {
    warn('type', 'package.json should say "type": "module" so .js files are ESM', 'package.json')
  }
  if (!kinds.length) {
    fail('kind', 'the package declares no plugin kind: give it a main/exports (provider), magpie.middleware, magpie.gateway, magpie.tools, magpie.page, magpie.agent or magpie.hooks')
  }

  if (kinds.includes('provider')) {
    const entry = providerEntry(pkg, files)
    if (!entry) {
      fail('entry', 'no entry file: magpie looks for exports["./server"], main, exports["."], then index.ts/tsx/js/mjs/cjs', 'package.json')
    } else if (!existsSync(join(root, entry))) {
      fail('entry', `the entry ${entry} does not exist`, entry)
    } else {
      const source = readFileSync(join(root, entry), 'utf8')
      checkProviderSource(source, entry, fail, warn)
    }
    if (!Array.isArray(pkg.files)) {
      warn('files', 'package.json files should list what ships, so tests and fixtures stay out of npm', 'package.json')
    }
  }

  const magpie = isObject(pkg.magpie) ? pkg.magpie : {}
  checkMagpieFields(magpie, root, files, kinds, fail, warn)
  if (magpie.middleware) {
    checkMoejsModule(join(root, magpie.middleware), magpie.middleware, 'middleware', fail, warn)
    checkCases(join(root, 'cases.json'), 'middleware', fail, warn)
  }
  if (magpie.gateway) {
    checkMoejsModule(join(root, magpie.gateway), magpie.gateway, 'routing', fail, warn)
    checkCases(join(root, 'strategies.json'), 'routing', fail, warn)
  }
  if (magpie.agent) checkMoejsModule(join(root, magpie.agent), magpie.agent, 'agent', fail, warn)
  if (magpie.hooks) checkHooksModule(join(root, magpie.hooks), magpie.hooks, fail, warn)
  if (magpie.page) checkPage(magpie.page, root, files, fail, warn)
  if (magpie.panels) checkPanels(magpie.panels, root, files, fail, warn)
  if (magpie.agent) checkAgent(join(root, magpie.agent), magpie.agent, fail, warn)
  if (Array.isArray(magpie.actions)) checkActions(magpie.actions, magpie.page, fail, warn)
  if (Array.isArray(magpie.permissions)) checkPermissions(magpie.permissions, fail, warn)

  // --- community conventions -------------------------------------------------
  const name = typeof pkg.name === 'string' ? pkg.name : null
  if (name?.startsWith('@magpie-community/')) {
    const expected = expectedCommunityName(name, kinds)
    if (expected) warn('community-name', `a community ${kinds[0]} package is named ${expected}`, 'package.json')
    const wantsKeyword = kinds.some((kind) => ['provider', 'tools', 'hooks', 'agent'].includes(kind))
    if (wantsKeyword && (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('magpie'))) {
      warn('keywords', 'add "magpie" to keywords so the card and search find it', 'package.json')
    }
    // The Plugins search asks npm for `<query> opencode` and shows a package
    // whose name or keywords hold `opencode` and one of auth/plugin/provider.
    if (kinds.includes('provider') && !searchableProvider(pkg)) {
      warn('keywords-search', 'a provider package needs "opencode" and one of "auth", "plugin" or "provider" in its keywords, or the Plugins search cannot find it', 'package.json')
    }
  }

  // A registry.json in the package (or the community repo root) must be one
  // magpie reads whole: one wrong type loses every listing.
  const registryFile = join(root, 'registry.json')
  if (existsSync(registryFile)) {
    for (const problem of registryProblems(readFileSync(registryFile, 'utf8'))) {
      fail('registry', problem, 'registry.json')
    }
  }

  return { dir: root, name, kinds, findings }
}

/** The community repository's naming: one prefix per kind. */
const COMMUNITY_PREFIX = {
  provider: 'opencode-<name>-auth',
  middleware: 'middleware-<name>',
  routing: 'middleware-<name>',
  tools: 'tools-<name>',
  page: 'page-<name>',
  agent: 'agent-<name>',
  hooks: 'gateway-<name>',
}

function expectedCommunityName(name, kinds) {
  const short = name.replace(/^@magpie-community\//, '')
  const kind = kinds.find((candidate) => COMMUNITY_PREFIX[candidate])
  if (!kind) return null
  const expected = COMMUNITY_PREFIX[kind]
  const prefix = expected.split('-<name>')[0]
  if (!short.startsWith(`${prefix}-`)) return `@magpie-community/${expected}`
  return null
}

// A provider entry must export only plugin functions: magpie calls every
// exported function as a plugin, so a helper export runs as one and fails.
function checkProviderSource(source, entry, fail, warn) {
  const exportFns = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  const exportConsts = [...source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/g)].map((m) => m[1])
  const exportFactories = [...source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*\(/g)].map((m) => m[1])
  // `export const X = plugin.server`, `export { X }`, `export { X as Y }`
  const exportValues = [...source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*\.\s*server\b/g)].map((m) => m[1])
  const exportLists = [...source.matchAll(/export\s*\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()?.trim()).filter(Boolean))
  const exportDefaults = /export\s+default\s+(?:\{|async|function|[A-Za-z_$])/.test(source)
  const fnNames = [...exportFns, ...exportConsts, ...exportFactories, ...exportValues, ...exportLists]
  const allowed = new Set(['_internal'])
  const suspicious = fnNames.filter((n) => allowed.has(n) || /^(helper|util|sign|parse|normalize|make|build|create|fetch|request|refresh|load|call|get|set|is|has)[A-Z_]/.test(n))
  if (suspicious.length) {
    fail('exported-helper', `magpie calls every exported function as a plugin; move ${suspicious.join(', ')} onto export const _internal = { … }`, entry)
  }
  if (!fnNames.length && !exportDefaults) {
    fail('exports', 'the entry exports no plugin function', entry)
  }
  if (/export\s+default\s+(?:async\s+)?\(/.test(source) && !/id\s*:/.test(source)) {
    warn('default-export', 'a default export must be { id, server } (OpenCode v1); a bare function is not loaded', entry)
  }
  if (/\bimport\s+[^'"]*from\s+['"]@opencode-ai\/plugin['"]/.test(source)) {
    warn('dependency', '@opencode-ai/plugin is only needed for tool()/zod helpers; plain JSON Schema needs no dependency', entry)
  }
}

function checkMagpieFields(magpie, root, files, kinds, fail, warn) {
  if (magpie.icon !== undefined) {
    const icon = magpie.icon
    if (typeof icon !== 'string') fail('icon', 'magpie.icon must be a string', 'package.json')
    else if (/^https:\/\//.test(icon)) { /* remote icons are fetched by magpie */ }
    else if (/^data:image\//.test(icon)) {
      if (bytes(icon) > 1_000_000) fail('icon', 'a data: icon must stay under 1 MB', 'package.json')
    } else if (!files.includes(icon.replace(/^\.\//, ''))) {
      warn('icon', `magpie.icon ${icon} is not a file in the package; give an https:// or data:image/ URL, or a path inside the package`, 'package.json')
    }
  }
  if (magpie.name !== undefined && (typeof magpie.name !== 'string' || bytes(magpie.name) > 80)) {
    fail('magpie-name', 'magpie.name is one line of at most 80 bytes', 'package.json')
  }
  if (magpie.summary !== undefined) {
    if (!isObject(magpie.summary)) fail('summary', 'magpie.summary is { "en": …, "zh": … }', 'package.json')
    else {
      for (const [lang, text] of Object.entries(magpie.summary)) {
        if (typeof text !== 'string' || bytes(text) > 300) fail('summary', `magpie.summary.${lang} is one line of at most 300 bytes`, 'package.json')
      }
      if (!magpie.summary.en) warn('summary', 'magpie.summary should have an English line; other languages fall back to it', 'package.json')
    }
  }
  if (magpie.maxConcurrency !== undefined) {
    const n = magpie.maxConcurrency
    if (!Number.isInteger(n) || n < 1 || n > 1000) fail('maxConcurrency', 'magpie.maxConcurrency is a whole number from 1 to 1000', 'package.json')
  }
  if (magpie.options !== undefined && !isObject(magpie.options)) {
    fail('options', 'magpie.options is the example options object the editor starts from', 'package.json')
  }
  void root
  void kinds
}

// Gateway middleware, routings and agents run in moejs inside magpie's own
// process: one file, relative imports only, no timers, no fetch, no Node APIs.
function checkMoejsModule(path, rel, kind, fail, warn) {
  if (!existsSync(path)) {
    fail(`${kind}-file`, `${rel} does not exist`, rel)
    return
  }
  const source = readFileSync(path, 'utf8')
  const forbidden = [
    [/\bimport\s+[^'"]*from\s+['"](?!\.)/, 'imports a bare package; moejs has no node_modules, so bundle it into the file'],
    [/\brequire\s*\(\s*['"](?!\.)/, 'requires a bare package; moejs has no node_modules'],
    [/\bimport\s*\(\s*['"](?!\.)/, 'dynamic import of a bare package; moejs has no node_modules'],
    [/\b(setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/, 'uses a timer; moejs has none'],
    [/\bfetch\s*\(/, 'uses fetch; moejs has none'],
    [/\bprocess\.(env|argv|platform|cwd)\b/, 'reads process; moejs has no Node APIs'],
    [/\bBuffer\b/, 'uses Buffer; moejs has no Node APIs'],
    [/\brequire\s*\(\s*['"]node:/, 'requires a Node built-in; moejs has none'],
  ]
  for (const [pattern, message] of forbidden) {
    if (pattern.test(source)) fail(`${kind}-moejs`, `${rel} ${message}`, rel)
  }
  if (kind === 'middleware') {
    if (!/\bexport\s+(?:async\s+)?function\s+on(Request|Event|Response|Provider|Account|Usage)\b/.test(source) && !/export\s+default\s*\{/.test(source)) {
      fail('middleware-hooks', `${rel} exports no hook: onRequest, onEvent, onResponse, onProvider, onAccount or onUsage`, rel)
    }
    if (/\bexport\s+(?:async\s+)?function\s+onUsage\b/.test(source) && !/\bexport\s+(?:async\s+)?function\s+on(Request|Event|Response|Provider|Account)\b/.test(source)) {
      warn('middleware-usage', `${rel} only exports onUsage; that is a gateway plugin, name it *.gateway.js or declare magpie.gateway`, rel)
    }
  }
  if (kind === 'routing' && !/\bexport\s+const\s+strategies\b/.test(source) && !/export\s+default\s*\{[^}]*strategies/s.test(source)) {
    fail('routing-strategies', `${rel} exports no strategies object`, rel)
  }
}

// The community repository runs a middleware's cases.json and a routing's
// strategies.json through one harness (scripts/middleware.mjs), so a package
// that moves there keeps its cases. The shapes are fixed there.
function checkCases(path, kind, fail, warn) {
  if (!existsSync(path)) {
    warn('cases', `no ${kind === 'routing' ? 'strategies.json' : 'cases.json'}; the community harness has nothing to run`, 'cases.json')
    return
  }
  let list
  try {
    list = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail('cases', `${basename(path)} is not JSON: ${error.message}`, basename(path))
    return
  }
  if (!Array.isArray(list) || !list.length) {
    fail('cases', `${basename(path)} is not a list of cases`, basename(path))
    return
  }
  for (const [index, entry] of list.entries()) {
    if (!isObject(entry)) {
      fail('cases', `${basename(path)}[${index}] is not an object`, basename(path))
      continue
    }
    if (kind === 'routing') {
      if (typeof entry.strategy !== 'string' || !entry.strategy) fail('cases', `${basename(path)}[${index}] names no strategy`, basename(path))
      if (!Array.isArray(entry.seats) || !entry.seats.length) fail('cases', `${basename(path)}[${index}] has no seats`, basename(path))
      if (!Array.isArray(entry.expect)) fail('cases', `${basename(path)}[${index}] expects no order`, basename(path))
      continue
    }
    if (typeof entry.name !== 'string' || !entry.name) fail('cases', `${basename(path)}[${index}] has no name`, basename(path))
    if (!entry.request && !entry.events && !entry.response) {
      fail('cases', `${basename(path)}[${index}] has nothing to run`, basename(path))
    }
  }
}

function checkHooksModule(path, rel, fail, warn) {
  if (!existsSync(path)) {
    fail('hooks-file', `${rel} does not exist`, rel)
    return
  }
  const source = readFileSync(path, 'utf8')
  if (!/\bexport\s+(?:async\s+)?function\s+on(Request|Response|SignIn)\b/.test(source) && !/export\s*\{[^}]*\bonRequest\b/.test(source)) {
    fail('hooks-exports', `${rel} exports no onRequest, onResponse or onSignIn`, rel)
  }
  if (/\bexport\s+default\b/.test(source)) warn('hooks-default', `${rel} exports a default; magpie reads named exports only`, rel)
}

function checkPage(page, root, files, fail, warn) {
  if (!isObject(page)) {
    fail('page', 'magpie.page is an object with title, file and icon', 'package.json')
    return
  }
  if (typeof page.title !== 'string' || !page.title) fail('page-title', 'magpie.page.title is the sidebar tab name', 'package.json')
  if (page.titles !== undefined && !isObject(page.titles)) fail('page-titles', 'magpie.page.titles maps a language code to a tab name', 'package.json')
  if (page.replaces !== undefined && !REPLACEABLE_PAGES.has(page.replaces)) {
    fail('page-replaces', `magpie.page.replaces is one of ${[...REPLACEABLE_PAGES].join(', ')}`, 'package.json')
  }
  if (typeof page.file !== 'string') {
    fail('page-file', 'magpie.page.file is the page HTML inside the package', 'package.json')
    return
  }
  const rel = page.file.replace(/^\.\//, '')
  if (!files.includes(rel)) {
    fail('page-file', `magpie.page.file ${page.file} does not exist`, rel)
    return
  }
  const html = readFileSync(join(root, rel), 'utf8')
  checkPageHtml(html, rel, page.file, files, fail, warn)
  if (page.icon !== undefined) {
    const icon = String(page.icon).replace(/^\.\//, '')
    if (!/^https:\/\//.test(icon) && !/^data:image\//.test(icon) && !files.includes(icon)) {
      fail('page-icon', `magpie.page.icon ${page.icon} does not exist`, icon)
    }
  }
}

function checkPageHtml(html, rel, pageFile, files, fail, warn) {
  if (!/<script\s+[^>]*src\s*=\s*["']_magpie\/bridge\.js["']/.test(html)) {
    fail('page-bridge', `${rel} does not load _magpie/bridge.js; without it magpie.read and magpie.ready do not exist`, rel)
  }
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  for (const match of inline) {
    if (match[1].trim()) {
      fail('page-inline-script', `${rel} has an inline <script>; the page's policy allows script files only (<script src>)`, rel)
      break
    }
  }
  const folder = pageFile.includes('/') ? pageFile.slice(0, pageFile.lastIndexOf('/') + 1) : ''
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const ref = match[1]
    if (/^(https?:|data:|_magpie\/|#)/.test(ref)) continue
    const resolved = ref.startsWith('/') ? ref.slice(1) : folder + ref.replace(/^\.\//, '')
    const clean = resolved.split('?')[0]
    if (!files.includes(clean)) fail('page-asset', `${rel} references ${ref}, which is not in the package`, clean)
  }
  if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\s*\(/.test(html)) {
    warn('page-network', `${rel} looks like it reaches the network; the page's policy is connect-src 'none'`, rel)
  }
  if (/<form\b|<iframe\b/.test(html)) warn('page-form', `${rel} has a form or frame; the page's policy allows neither`, rel)
}

function checkPanels(panels, root, files, fail, warn) {
  if (!Array.isArray(panels)) {
    fail('panels', 'magpie.panels is an array of { slot, file, title }', 'package.json')
    return
  }
  if (panels.length > 8) fail('panels-count', 'a plugin has at most 8 panels', 'package.json')
  for (const [index, panel] of panels.entries()) {
    if (!isObject(panel)) {
      fail('panel', `magpie.panels[${index}] is an object`, 'package.json')
      continue
    }
    if (!PANEL_SLOTS.has(panel.slot)) fail('panel-slot', `magpie.panels[${index}].slot is one of ${[...PANEL_SLOTS].join(', ')}`, 'package.json')
    if (typeof panel.title !== 'string' || !panel.title) fail('panel-title', `magpie.panels[${index}].title is the card heading`, 'package.json')
    if (typeof panel.file !== 'string' || !files.includes(panel.file.replace(/^\.\//, ''))) {
      fail('panel-file', `magpie.panels[${index}].file does not exist`, String(panel.file))
      continue
    }
    const rel = panel.file.replace(/^\.\//, '')
    const html = readFileSync(join(root, rel), 'utf8')
    checkPageHtml(html, rel, rel, files, fail, warn)
    if (/html\s*,?\s*body\s*\{[^}]*height\s*:/i.test(html) || /body\s*\{[^}]*height\s*:\s*\d/i.test(html)) {
      warn('panel-height', `${rel} gives html or body a fixed height; a panel sizes itself from its content`, rel)
    }
  }
}

function checkAgent(path, rel, fail, warn) {
  if (!existsSync(path)) return
  const source = readFileSync(path, 'utf8')
  const idMatch = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(source)
  if (!idMatch) {
    fail('agent-id', `${rel} declares no agent.id`, rel)
    return
  }
  const id = idMatch[1]
  if (!/^[a-z0-9._-]+$/.test(id)) fail('agent-id', `agent.id ${id} uses lower-case letters, digits, . _ and -`, rel)
  if (BUILTIN_AGENTS.has(id)) fail('agent-id', `agent.id ${id} is one of magpie's own agents; a plugin adds an agent, it does not replace one`, rel)
  if (!/\bexport\s+const\s+agent\b/.test(source)) fail('agent-export', `${rel} exports no agent object`, rel)
  if (!/\bexport\s+(?:async\s+)?function\s+connect\b/.test(source) && !/\bconnect\s*[:(]/.test(source)) {
    warn('agent-connect', `${rel} exports no connect(); without it magpie writes only the model`, rel)
  }
  const library = /library\s*:\s*\{([\s\S]*?)\}/.exec(source)
  if (library) {
    const format = /mcpFormat\s*:\s*['"]([^'"]+)['"]/.exec(library[1])
    if (/\bmcp\s*:/.test(library[1]) && !format) fail('agent-mcp-format', `${rel} gives library.mcp without mcpFormat; the plugin will not load`, rel)
    else if (format && !MCP_FORMATS.has(format[1])) fail('agent-mcp-format', `${rel} library.mcpFormat ${format[1]} is not one magpie knows`, rel)
  }
}

function checkActions(actions, page, fail, warn) {
  if (!page) fail('actions-page', 'magpie.actions needs magpie.page; a plugin without a page adds no menu items', 'package.json')
  if (actions.length > 8) fail('actions-count', 'a plugin has at most 8 menu items', 'package.json')
  for (const [index, action] of actions.entries()) {
    if (!isObject(action)) {
      fail('action', `magpie.actions[${index}] is an object`, 'package.json')
      continue
    }
    if (typeof action.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(action.id)) {
      fail('action-id', `magpie.actions[${index}].id is lower-case letters, digits and dashes, up to 40`, 'package.json')
    }
    if (action.menu !== 'provider' && action.menu !== 'agent') {
      fail('action-menu', `magpie.actions[${index}].menu is provider or agent`, 'package.json')
    }
  }
  void warn
}

function checkPermissions(permissions, fail, warn) {
  const known = new Set(['usage:summary', 'providers:list'])
  for (const permission of permissions) {
    if (!known.has(permission)) fail('permission', `${permission} is not a read magpie offers; the page is refused it`, 'package.json')
  }
  if (!permissions.length) warn('permissions', 'magpie.permissions is empty; the page can read nothing but its options', 'package.json')
}

/**
 * A one-line summary for a tool result.
 * @param {ReturnType<typeof checkPackage>} report
 */
export function summarize(report) {
  const fails = report.findings.filter((f) => f.level === 'fail').length
  const warns = report.findings.filter((f) => f.level === 'warn').length
  return { fails, warns, ok: fails === 0 }
}

/** The package's own files, for callers that need them (the scaffold, the checks). */
export function packageFiles(dir) {
  return listFiles(resolve(dir))
}

/** Whether a path is a directory that holds a package.json. */
export function isPackageDir(dir) {
  try {
    return statSync(join(dir, 'package.json')).isFile()
  } catch {
    return false
  }
}

/** The folder name a package lives in, for messages. */
export function packageFolder(dir) {
  return basename(resolve(dir))
}

/** A path relative to the package, for messages. */
export function relTo(dir, file) {
  return relative(resolve(dir), resolve(file)).split('\\').join('/')
}
