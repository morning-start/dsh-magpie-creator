// `registry.json` — the list magpie's Plugins page suggests — checked against
// what magpie's own reader takes (`internal/plugin/market.go`, `parseMarket`).
//
// That reader unmarshals the whole file into typed fields, so one value of the
// wrong type (a string for "providers", "true" for "community") loses **every**
// listing, not just its own. It keeps an entry only when "package" matches its
// pkgName pattern, and the page sorts by "kind", so an unknown kind lists a
// middleware or an agent as a provider. Ported from the community repository's
// `scripts/registry.mjs`, which is the only place this contract is written down.
//
// Read-only: nothing here fetches or writes.

/** magpie's pkgName (`internal/plugin/store.go`) and npm's length limit. */
const PKG_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const PKG_NAME_FULL = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
/** Every kind an entry may name; a provider's entry has none. */
export const KINDS = ['middleware', 'hooks', 'agent', 'tools', 'page']
/** The only fields magpie reads; an unknown one is a mistake, not a hint. */
export const FIELDS = ['package', 'name', 'icon', 'providers', 'community', 'replaces', 'kind', 'summary']
/** The languages a summary must carry. */
export const LANGUAGES = ['en', 'zh']
/** magpie fetches the list at most this big (`fetchJSONFaithful`'s limit). */
const MAX_BYTES = 1 << 20

const text = (value) => typeof value === 'string' && value.trim() !== ''

/**
 * The problems with a registry.json's text, none when magpie reads it whole.
 * @param {string} source the file's text
 * @returns {string[]} one line per problem
 */
export function registryProblems(source) {
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) return [`registry.json is over ${MAX_BYTES} bytes, more than magpie fetches`]
  let registry
  try {
    registry = JSON.parse(source)
  } catch (error) {
    return [`registry.json is not JSON: ${error.message}`]
  }
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return ['registry.json is not an object']
  const problems = []
  if (registry.version !== 1) problems.push(`version ${JSON.stringify(registry.version)}, not 1`)
  if (!Array.isArray(registry.plugins) || !registry.plugins.length) return [...problems, 'plugins is not a list of entries']
  const seen = new Map()
  registry.plugins.forEach((entry, index) => {
    const at = `plugins[${index}]${text(entry?.package) ? ` (${entry.package})` : ''}`
    const bad = (why) => problems.push(`${at}: ${why}`)
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return bad('not an object')
    for (const key of Object.keys(entry)) if (!FIELDS.includes(key)) bad(`unknown field ${JSON.stringify(key)}`)
    if (typeof entry.package !== 'string' || !PKG_NAME_FULL.test(entry.package) || entry.package.length > 214) {
      bad(`package ${JSON.stringify(entry.package)} is not an npm package name`)
    } else if (seen.has(entry.package)) {
      bad(`package listed again (first at plugins[${seen.get(entry.package)}])`)
    } else {
      seen.set(entry.package, index)
    }
    if (!text(entry.name)) bad('no name')
    if ('kind' in entry && !KINDS.includes(entry.kind)) bad(`kind ${JSON.stringify(entry.kind)} is not one of ${KINDS.join(', ')} (a provider has none)`)
    // A provider's entry names its provider ids and carries no kind; a listed
    // kind and providers together is neither shape, and the page groups by kind,
    // so the card lands under the kind and the ids are never read.
    if (KINDS.includes(entry.kind) && 'providers' in entry) {
      bad(`kind ${JSON.stringify(entry.kind)} and providers together: a provider's entry has providers and no kind, every other kind has a kind and no providers`)
    }
    if ('community' in entry && typeof entry.community !== 'boolean') bad('community is not true or false')
    if ('replaces' in entry && !text(entry.replaces)) bad('replaces is not a subscription id')
    if ('providers' in entry && (!Array.isArray(entry.providers) || !entry.providers.length || !entry.providers.every(text))) {
      bad('providers is not a list of provider ids')
    }
    if ('icon' in entry) {
      // A bundled icon's name, or a picture: an https URL or a data:image URI.
      if (!text(entry.icon)) bad('icon is empty')
      else if (/[:/]/.test(entry.icon) && !/^(https:\/\/|data:image\/)/i.test(entry.icon)) bad(`icon ${JSON.stringify(entry.icon.slice(0, 60))} is not https or data:image`)
    }
    if (!entry.summary || typeof entry.summary !== 'object' || Array.isArray(entry.summary)) bad('no summary')
    else {
      for (const language of LANGUAGES) if (!text(entry.summary[language])) bad(`no summary.${language}`)
      for (const [language, summary] of Object.entries(entry.summary)) if (typeof summary !== 'string') bad(`summary.${language} is not text`)
    }
  })
  return problems
}

/** The `kind` a package's plugin kinds map to in the registry (a provider has none). */
export function registryKind(kinds) {
  if (kinds.includes('page')) return 'page'
  if (kinds.includes('agent')) return 'agent'
  if (kinds.includes('tools')) return 'tools'
  if (kinds.includes('hooks')) return 'hooks'
  if (kinds.includes('middleware') || kinds.includes('routing')) return 'middleware'
  return undefined
}

/** A short name magpie shows: the community prefix and kind stripped. */
export function displayName(packageName) {
  return String(packageName)
    .replace(/^@[^/]+\//, '')
    .replace(/^opencode-/, '')
    .replace(/-auth$/, '')
    .replace(/^(middleware|tools|page|agent|gateway)-/, '')
}

/**
 * The registry entry a package should carry, in the shape magpie reads.
 * @param {object} pkg its package.json
 * @param {string[]} kinds from `kindsOf`
 * @param {{ summaryZh?: string, providers?: string[], icon?: string }} [extra]
 * @returns {object} the entry
 */
export function registryEntry(pkg, kinds, extra = {}) {
  const kind = registryKind(kinds)
  const summary = { en: pkg.description ?? '', zh: extra.summaryZh ?? '' }
  const entry = {
    package: pkg.name,
    name: pkg.magpie?.name ?? displayName(pkg.name),
    ...(kind === undefined ? {} : { kind }),
    ...(pkg.name.startsWith('@magpie-community/') ? { community: true } : {}),
    ...(kind === undefined ? { providers: extra.providers ?? ['<provider id>'] } : {}),
    ...(extra.icon ?? pkg.magpie?.icon ? { icon: extra.icon ?? pkg.magpie.icon } : {}),
    summary,
  }
  return entry
}

/**
 * Whether a provider package's keywords let magpie's search find it: the page
 * asks npm for `<query> opencode` and shows a package whose name or keywords
 * hold `opencode` **and** one of `auth`, `plugin` or `provider`.
 * @param {object} pkg its package.json
 * @returns {boolean}
 */
export function searchableProvider(pkg) {
  const words = [pkg.name, ...(Array.isArray(pkg.keywords) ? pkg.keywords : [])].join(' ').toLowerCase()
  return words.includes('opencode') && ['auth', 'plugin', 'provider'].some((word) => words.includes(word))
}

export { PKG_NAME as PKG_NAME_PATTERN }
