// Creating — or adopting — the GitHub repository a scaffolded package lives in.
//
// The convention this encodes: public by default, and carrying the
// `magpie-plugin` topic, which is what makes the repository show up in
// magpie's Discover → Unofficial list. It also points package.json's
// `repository` at that repository, because npm provenance refuses to publish a
// package that names some other repository.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const TOPIC = 'magpie-plugin'

function sh(command, args, options) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

function trySh(run, command, args, cwd) {
  try {
    return run(command, args, { cwd })
  } catch {
    return null
  }
}

/** `owner/name` from a GitHub clone URL, or null for any other host. */
export function githubSlug(url) {
  const cleaned = String(url).trim().replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '')
  const match =
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(cleaned) ??
    /^git@github\.com:([^/]+)\/([^/]+)$/.exec(cleaned) ??
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/.exec(cleaned)
  return match ? `${match[1]}/${match[2]}` : null
}

/**
 * Create the repository for a scaffolded package and push it, or update the one
 * the directory already points at: make it the requested visibility, add the
 * `magpie-plugin` topic, and align `package.json` with it.
 *
 * @param {object} plan
 * @param {string} plan.dir the package directory
 * @param {string} [plan.owner] GitHub user or organization, default: the `gh` login
 * @param {string} [plan.name] repository name, default: the package name without its scope
 * @param {boolean} [plan.privateRepo] false: public, which is what Discover lists
 * @param {boolean} [plan.dryRun] print the commands without running the ones that change anything
 * @param {Function} [plan.run] command runner, for tests
 * @returns {{ repo: string, action: 'created' | 'updated', topic: string, private: boolean, dryRun: boolean, commands: string[] }}
 */
export function handleRepo(plan = {}) {
  const root = resolve(plan.dir ?? '.')
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`${root} has no package.json; scaffold the package first`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const run = plan.run ?? sh
  const dryRun = Boolean(plan.dryRun)
  const visibility = plan.privateRepo ? 'private' : 'public'

  // `git remote` from a directory inside another checkout answers for that
  // checkout, so the origin only counts when this directory is its own repo.
  const toplevel = trySh(run, 'git', ['rev-parse', '--show-toplevel'], root)
  const ownRepo = Boolean(toplevel) && resolve(toplevel) === root
  const origin = ownRepo ? trySh(run, 'git', ['remote', 'get-url', 'origin'], root) : null

  const commands = []
  const step = (command, args) => {
    commands.push(`${command} ${args.join(' ')}`)
    if (!dryRun) run(command, args, { cwd: root })
  }

  let repo
  let created = false
  if (origin) {
    repo = githubSlug(origin)
    if (!repo) {
      throw new Error(`${root} has origin ${origin}, which is not a GitHub repository; this tool only sets up GitHub`)
    }
    let view
    try {
      view = JSON.parse(run('gh', ['repo', 'view', repo, '--json', 'visibility'], { cwd: root }))
    } catch {
      throw new Error(`origin points at ${repo}, but gh cannot read it; create it first:\n  gh repo create ${repo} --${visibility} --source . --push`)
    }
    // gh prints the visibility in upper case (PUBLIC); compare in one case.
    const currentVisibility = String(view.visibility ?? '').toLowerCase()
    if (currentVisibility && currentVisibility !== visibility) {
      step('gh', ['repo', 'edit', repo, '--visibility', visibility])
    }
  } else {
    const owner = plan.owner ?? run('gh', ['api', 'user', '--jq', '.login'], { cwd: root })
    const name = plan.name ?? String(pkg.name ?? '').replace(/^@[^/]+\//, '')
    if (!owner || !name) throw new Error('cannot tell the repository name; pass --owner and --name')
    repo = `${owner}/${name}`
  }

  if (!existsSync(join(root, '.git'))) {
    step('git', ['init'])
    step('git', ['add', '-A'])
    step('git', ['commit', '-m', 'Initial commit'])
  }

  // A placeholder is the template's OWNER/REPO; a missing repository has the
  // same problem. A real but different URL is just as fatal: provenance ties
  // the package to the repository it was published from.
  const current = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const wanted = `git+https://github.com/${repo}.git`
  if (current !== wanted) {
    const directory = pkg.repository?.directory
    pkg.repository = { type: 'git', url: wanted, ...(directory ? { directory } : {}) }
    if (!dryRun) writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    step('git', ['add', 'package.json'])
    step('git', ['commit', '-m', `chore: point repository at ${repo}`])
  }

  if (!origin) {
    step('gh', ['repo', 'create', repo, plan.privateRepo ? '--private' : '--public', '--source', '.', '--remote', 'origin', '--push'])
    created = true
  }
  const edit = ['repo', 'edit', repo, '--add-topic', TOPIC]
  if (pkg.description) edit.push('--description', pkg.description)
  step('gh', edit)

  return { repo, action: created ? 'created' : 'updated', topic: TOPIC, private: Boolean(plan.privateRepo), dryRun, commands }
}