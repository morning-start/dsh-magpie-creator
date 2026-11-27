// Scaffolding a magpie plugin package from the templates in ./templates.
//
// Deterministic: the same arguments always write the same bytes. Nothing is
// installed, no network is touched, and an existing non-empty directory is
// refused unless `force` is set (which overwrites only the files this module
// writes).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const TEMPLATES = join(here, '..', 'templates')

/**
 * The kinds a package can be, and what each one needs.
 * `prefix` is the community package-name prefix; `entry` the file magpie loads.
 */
export const KINDS = {
  provider: { prefix: 'opencode-<name>-auth', entry: 'index.mjs', runtime: 'bun', what: 'a subscription or vendor signed in to, served as a provider' },
  middleware: { prefix: 'middleware-<name>', entry: '<name>.middleware.js', runtime: 'moejs', what: 'rewrites requests and replies on their way through the gateway' },
  routing: { prefix: 'middleware-<name>', entry: '<name>.gateway.js', runtime: 'moejs', what: 'orders the accounts or keys a request may go to' },
  tools: { prefix: 'tools-<name>', entry: 'index.mjs', runtime: 'bun', what: 'tools every agent gets through /mcp/magpie/tools' },
  page: { prefix: 'page-<name>', entry: 'page/index.html', runtime: 'browser', what: 'a page in magpie\'s window' },
  agent: { prefix: 'agent-<name>', entry: '<name>.agent.js', runtime: 'moejs', what: 'an agent magpie has no setup for, on the Agents page' },
  hooks: { prefix: 'gateway-<name>', entry: '<name>.hooks.mjs', runtime: 'bun', what: 'async gateway request hooks (recall, capture, notify)' },
}

/** The kind a package name declares, from its community prefix. */
export function kindFromName(name) {
  const short = String(name).replace(/^@[^/]+\//, '')
  if (/^opencode-.*-auth$/.test(short)) return 'provider'
  if (/^middleware-/.test(short)) return 'middleware'
  if (/^tools-/.test(short)) return 'tools'
  if (/^page-/.test(short)) return 'page'
  if (/^agent-/.test(short)) return 'agent'
  if (/^gateway-/.test(short)) return 'hooks'
  return null
}

/** The short name magpie uses for a package (`<plugin>_<tool>`, routing names). */
export function shortName(packageName) {
  return String(packageName)
    .replace(/^@[^/]+\//, '')
    .replace(/^opencode-/, '')
    .replace(/-auth$/, '')
    .replace(/^(middleware|tools|page|agent|gateway)-/, '')
}

/** A valid provider id: lower-case letters, digits and dashes. */
export function providerId(name) {
  const id = shortName(name).replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return id || 'my-vendor'
}

function titleCase(text) {
  return text
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function pascal(text) {
  return titleCase(text).replace(/[^A-Za-z0-9]/g, '')
}

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] === undefined ? '' : String(vars[key])))
}

/** Read every file of a template folder, relative and with forward slashes. */
function readTemplate(kind, sub = '') {
  const root = join(TEMPLATES, kind, sub)
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else out.push({ rel, text: readFileSync(join(dir, entry.name), 'utf8') })
    }
  }
  walk(root, '')
  return out
}

/**
 * The files a scaffold would write, without writing them.
 * @param {object} plan
 * @returns {Array<{ rel: string, text: string }>}
 */
export function planFiles(plan) {
  const kind = plan.kind
  const name = plan.packageName
  const short = shortName(name)
  const vars = {
    packageName: name,
    short,
    id: plan.id ?? providerId(name),
    title: plan.title ?? titleCase(short),
    titleZh: plan.titleZh ?? '',
    description: plan.description ?? '',
    descriptionZh: plan.descriptionZh ?? '',
    pascal: pascal(short),
    baseUrl: plan.baseUrl ?? 'https://api.example.com/v1',
    vendor: plan.vendor ?? titleCase(short),
    year: String(new Date().getFullYear()),
    ...plan.vars,
  }
  const files = readTemplate(kind).map(({ rel, text }) => ({
    rel: fill(rel, vars),
    text: fill(text, vars),
  }))
  return files
}

/**
 * Write a plugin package.
 * @param {object} plan
 * @param {string} plan.dir the package directory to create
 * @param {keyof typeof KINDS} plan.kind
 * @param {string} plan.packageName
 * @param {boolean} [plan.force]
 * @returns {{ dir: string, kind: string, files: string[], skipped: string[] }}
 */
export function scaffold(plan) {
  const dir = resolve(plan.dir)
  if (!KINDS[plan.kind]) throw new Error(`unknown kind ${plan.kind}; one of ${Object.keys(KINDS).join(', ')}`)
  if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(plan.packageName)) {
    throw new Error(`package name ${plan.packageName} is not a lowercase npm name (optionally scoped)`)
  }
  const exists = existsSync(dir)
  if (exists && !statSync(dir).isDirectory()) throw new Error(`${dir} exists and is not a directory`)
  if (exists && readdirSync(dir).length && !plan.force) {
    throw new Error(`${dir} is not empty; pass force: true to write the template files over it`)
  }
  const files = planFiles(plan)
  const written = []
  for (const file of files) {
    const target = join(dir, file.rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.text, 'utf8')
    written.push(file.rel)
  }
  return { dir, kind: plan.kind, files: written.sort(), skipped: [] }
}
