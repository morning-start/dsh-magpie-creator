/**
 * Magpie-mode tools for `dsh-magpie-creator`.
 *
 * Mounted only inside the Magpie mode preset (`preset-magpie`), so no other
 * preset gains a tool. Four tools, each read-only except `magpie_plugin_new`
 * (which writes a new package folder) and `magpie_sandbox` (which touches only
 * its own sandbox folder):
 *
 *   magpie_doctor        what is on this machine, and what a plugin author needs
 *   magpie_plugin_new    scaffold a plugin package from a template
 *   magpie_plugin_check  check a package the way magpie loads it
 *   magpie_sandbox       a magpie of its own, so the user's is never touched
 *
 * Nothing here installs into the user's magpie, signs in, or changes the
 * profile. The one command that would (`magpie plugin add` outside a sandbox)
 * is printed for the user to run.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPackage, summarize } from '../lib/check.mjs'
import { doctor } from '../lib/doctor.mjs'
import { loadAndCheck } from '../lib/load.mjs'
import { locateMagpie, runMagpie } from '../lib/magpie.mjs'
import { registryEntry, registryProblems } from '../lib/registry.mjs'
import {
  readSandboxState, sandboxCommand, sandboxEnv, sandboxPaths, writeSandboxState,
} from '../lib/sandbox.mjs'
import { KINDS, kindFromName, planFiles, scaffold, shortName } from '../lib/scaffold.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(here, '..')

/**
 * Cordis names the services this plugin needs before `apply` runs. Without it
 * `ctx.tools` is not readable and the whole preset row is reported broken —
 * which is how this plugin first shipped, silently missing from the mode picker.
 */
export const name = 'magpie-tools'
export const inject = ['tools']

const text = (value) => [{ type: 'text', text: value }]

function renderFindings(report) {
  const lines = [`${report.dir}`, `kinds: ${report.kinds.length ? report.kinds.join(', ') : '(none)'}`]
  const fails = report.findings.filter((f) => f.level === 'fail')
  const warns = report.findings.filter((f) => f.level === 'warn')
  if (!fails.length && !warns.length) lines.push('✓ no problems found')
  for (const finding of fails) lines.push(`✗ ${finding.rule}: ${finding.message}${finding.file ? ` (${finding.file})` : ''}`)
  for (const finding of warns) lines.push(`! ${finding.rule}: ${finding.message}${finding.file ? ` (${finding.file})` : ''}`)
  const { fails: failCount, warns: warnCount } = summarize(report)
  lines.push(`${failCount} fail, ${warnCount} warn`)
  return lines.join('\n')
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const register = (definition) => {
    // `inject` above guarantees the service; the fallback keeps a Host that
    // renamed it from failing at import time.
    if (typeof ctx.tools?.register === 'function') ctx.tools.register(definition)
    else if (typeof ctx.tool === 'function') ctx.tool(definition)
    else throw new Error('@morning-start/dsh-magpie-creator/tools needs the DSH tools service')
  }

  register({
    name: 'magpie_doctor',
    description:
      'Report what a magpie plugin author can do on this machine: where the magpie CLI is and its version, whether a gateway is serving, where its config folder is, whether its Bun plugin host is downloaded, and which plugins are installed. Read-only; installs nothing. Call it before debugging a plugin or a sandbox.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute() {
      const report = await doctor()
      const lines = [
        `platform: ${report.platform}`,
        `magpie: ${report.magpie.path ?? 'not found'}${report.magpie.version ? ` (${report.magpie.version})` : ''}`,
        `config: ${report.config}`,
        `plugins installed: ${report.plugins.count}`,
        '',
      ]
      for (const check of report.checks) {
        lines.push(`${check.ok ? '✓' : '✗'} ${check.id}: ${check.detail}`)
        if (!check.ok && check.fix) lines.push(`    → ${check.fix}`)
      }
      lines.push('', report.ok ? 'ready to build a plugin' : 'some checks need the user first; a folder plugin is still testable in a sandbox')
      return lines.join('\n')
    },
  })

  register({
    name: 'magpie_plugin_new',
    description:
      'Scaffold a magpie plugin package from a template: provider (an OpenCode auth plugin), middleware, routing, tools, page, agent or hooks. Writes package.json, the entry file, a test and a README, then checks the result. Deterministic; installs nothing. The package name must follow @author/name (a lowercase npm scope, then a lowercase name) — a bare name is refused, because it neither says whose package it is nor can be renamed after publishing. The kind comes from the package name if it carries a community prefix, otherwise pass it.',
    parameters: {
      kind: { type: 'string', enum: Object.keys(KINDS), description: 'Which kind of plugin. Defaults to the kind the package name declares, else provider.' },
      packageName: { type: 'string', required: true, description: 'npm package name in @author/name form, e.g. @acme/calc or @acme/opencode-acme-auth' },
      dir: { type: 'string', description: 'Directory to create. Defaults to <cwd>/<short name>.' },
      title: { type: 'string', description: 'Display name, e.g. "Acme Coding Plan".' },
      titleZh: { type: 'string', description: 'Chinese display name, for a page tab or a card.' },
      description: { type: 'string', description: 'One line: what it does and where it appears.' },
      id: { type: 'string', description: 'Provider id (lower-case letters, digits and dashes). Defaults to the short name.' },
      baseUrl: { type: 'string', description: 'Provider base URL, e.g. https://api.acme.example/v1.' },
      force: { type: 'boolean', description: 'Write into a directory that already has files. Overwrites only the template files.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      const packageName = String(args.packageName ?? '').trim()
      if (!packageName) throw new Error('packageName is required')
      const kind = (args.kind ?? kindFromName(packageName)) || 'provider'
      if (!KINDS[kind]) throw new Error(`kind ${kind} is not one of ${Object.keys(KINDS).join(', ')}`)
      const short = shortName(packageName)
      const cwd = exec?.agent?.session?.cwd ?? process.cwd()
      const dir = resolve(args.dir ?? join(cwd, short))
      const result = scaffold({
        dir,
        kind,
        packageName,
        title: args.title,
        titleZh: args.titleZh,
        description: args.description ?? `${KINDS[kind].what}.`,
        id: args.id,
        baseUrl: args.baseUrl,
        force: Boolean(args.force),
      })
      const report = checkPackage(result.dir)
      return [
        `created ${result.kind} plugin at ${result.dir}`,
        `files: ${result.files.join(', ')}`,
        '',
        renderFindings(report),
        '',
        'next: fill in the TODO parts of the entry file, then `magpie_plugin_check` again, then test it in `magpie_sandbox`.',
      ].join('\n')
    },
  })

  register({
    name: 'magpie_plugin_check',
    description:
      'Check a magpie plugin package the way magpie loads it: manifest and entry, provider exports, moejs limits for middleware/routing/agent files (no timers, no fetch, no Node APIs, no bare imports), page bridge/inline-script/asset/permission rules, panel and action limits, hooks exports, community naming, and the registry.json entry magpie\'s Plugins page reads. Read-only. With load: true it also imports the package and calls its plugin functions with a stand-in client, the way the community repository\'s checker does. A fail is something magpie would refuse to load; a warn is something it would silently do differently.',
    parameters: {
      dir: { type: 'string', required: true, description: 'Absolute path to the package directory (the folder holding package.json).' },
      load: { type: 'boolean', description: 'Also import the package and call its plugin functions (runs its top-level code in this process; signs in to nothing and sends no request).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args) {
      const dir = resolve(String(args.dir ?? ''))
      if (!existsSync(dir)) throw new Error(`${dir} does not exist`)
      const report = checkPackage(dir)
      if (args.load) {
        const loaded = await loadAndCheck(dir)
        for (const problem of loaded.problems) report.findings.push({ level: 'fail', rule: 'hooks', message: problem })
      }
      return renderFindings(report)
    },
  })

  register({
    name: 'magpie_plugin_accept',
    description:
      'Prove a plugin installs: the only check that asks magpie itself rather than reading source. Runs the static checks, then in a sandbox of its own runs `magpie plugin add`, reads `magpie plugin --json` for a load error, and — for a middleware or routing — reports the hooks magpie says it will call. Touches only the sandbox folder, never the user\'s magpie. A sandbox has no provider credentials, so it cannot prove a vendor sign-in works or that a middleware changes a real request; the report says so.',
    parameters: {
      dir: { type: 'string', required: true, description: 'Absolute path to the package directory.' },
      sandbox: { type: 'string', description: 'Sandbox name to install into. Defaults to "accept".' },
      port: { type: 'number', description: 'The sandbox gateway port. Defaults to 3599.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args) {
      const dir = resolve(String(args.dir ?? ''))
      if (!existsSync(dir)) throw new Error(`${dir} does not exist`)
      const { acceptPlugin } = await import('../lib/accept.mjs')
      const report = await acceptPlugin(dir, {
        sandbox: String(args.sandbox ?? 'accept'),
        port: Number(args.port ?? 3599),
      })
      const lines = report.checks.map((check) => {
        const mark = check.ok === true ? '✓' : check.ok === null ? '?' : '✗'
        return `${mark} ${check.name}: ${check.detail}`
      })
      if (report.unproven.length) {
        lines.push('', 'this sandbox cannot prove:')
        for (const line of report.unproven) lines.push(`  - ${line}`)
      }
      lines.push('', report.failures.length ? `${report.failures.length} failure(s)` : '✓ magpie accepts this plugin')
      return lines.join('\n')
    },
  })

  register({
    name: 'magpie_sandbox',
    description:
      'A magpie of its own for testing a plugin, so the user\'s magpie, its sign-ins and its agents are never touched: its own HOME, config folder and gateway port. Actions: create (a folder and its state), install (magpie plugin add inside the sandbox), list (what the sandbox loaded), login (sign in inside the sandbox), test (one tiny request per API), remove (delete the sandbox folder), command (the shell lines that run magpie inside it). Never touches the user\'s magpie.',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'install', 'list', 'login', 'test', 'remove', 'command', 'status'], description: 'What to do in the sandbox.' },
      name: { type: 'string', required: true, description: 'Sandbox name: lower-case letters, digits and dashes.' },
      plugin: { type: 'string', description: 'For create and install: the plugin package directory, or an npm/git spec.' },
      provider: { type: 'string', description: 'For login and test: the provider id.' },
      port: { type: 'number', description: 'For create: the gateway port. Defaults to the next free one from 3499.' },
      confirm: { type: 'boolean', description: 'For remove: must be true; the sandbox folder and its sign-ins are deleted.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args) {
      const name = String(args.name ?? '').trim()
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error('name is lower-case letters, digits and dashes')
      const paths = sandboxPaths(name)
      const bin = locateMagpie().path
      const state = readSandboxState(paths)
      const port = state?.port ?? args.port ?? 3499

      const run = async (argv, timeoutMs = 180_000) => {
        if (!bin) throw new Error('magpie was not found; run magpie_doctor')
        return runMagpie(argv, { bin, env: sandboxEnv(paths, { port }), timeoutMs })
      }
      const output = (result) => [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || `(exit ${result.code})`

      switch (args.action) {
        case 'create': {
          for (const dir of [paths.home, paths.config, paths.cache, paths.state]) mkdirSync(dir, { recursive: true })
          const saved = writeSandboxState(paths, {
            name, port, created: new Date().toISOString(), plugin: args.plugin ?? state?.plugin ?? null,
          })
          return [
            `sandbox ${name} at ${paths.dir}`,
            `gateway port ${port}`,
            '',
            'run magpie inside it:',
            sandboxCommand(paths, { bin: bin ?? 'magpie', port, shell: process.platform === 'win32' ? 'pwsh' : 'sh' }),
            '',
            saved.plugin ? `next: magpie_sandbox { action: "install", name: "${name}", plugin: "${saved.plugin}" }` : 'next: give it a plugin with magpie_sandbox { action: "install", … }',
          ].join('\n')
        }
        case 'install': {
          if (!state) throw new Error(`sandbox ${name} does not exist; create it first`)
          const target = String(args.plugin ?? state.plugin ?? '')
          if (!target) throw new Error('plugin is required')
          const resolved = target.startsWith('.') || target.includes('/') || target.includes('\\') ? resolve(target) : target
          const result = await run(['plugin', 'add', resolved])
          writeSandboxState(paths, { ...state, plugin: resolved, installedAt: new Date().toISOString() })
          return [`magpie plugin add ${resolved} (in sandbox ${name})`, '', output(result)]
        }
        case 'list': {
          if (!state) throw new Error(`sandbox ${name} does not exist; create it first`)
          const result = await run(['plugin'])
          return [`plugins in sandbox ${name}`, '', output(result)]
        }
        case 'status': {
          if (!state) throw new Error(`sandbox ${name} does not exist; create it first`)
          const result = await run(['status', '--json'], 30_000)
          return [`sandbox ${name} at ${paths.dir}`, '', output(result)]
        }
        case 'login': {
          if (!state) throw new Error(`sandbox ${name} does not exist; create it first`)
          const provider = String(args.provider ?? '')
          if (!provider) throw new Error('provider is required')
          const result = await run(['plugin', 'login', provider], 300_000)
          return [`magpie plugin login ${provider} (in sandbox ${name})`, '', output(result)]
        }
        case 'test': {
          if (!state) throw new Error(`sandbox ${name} does not exist; create it first`)
          const provider = String(args.provider ?? '')
          if (!provider) throw new Error('provider is required')
          const result = await run(['provider', 'test', provider], 180_000)
          return [`magpie provider test ${provider} (in sandbox ${name})`, '', output(result)]
        }
        case 'command': {
          return sandboxCommand(paths, { bin: bin ?? 'magpie', port, shell: process.platform === 'win32' ? 'pwsh' : 'sh' })
        }
        case 'remove': {
          if (args.confirm !== true) throw new Error('remove deletes the sandbox folder and its sign-ins; pass confirm: true')
          if (existsSync(paths.dir)) rmSync(paths.dir, { recursive: true, force: true })
          return `removed sandbox ${name} (${paths.dir})`
        }
        default:
          throw new Error(`unknown action ${args.action}`)
      }
    },
  })

  // A fifth, tiny tool: the templates' own path, so a skill can point at them.
  register({
    name: 'magpie_templates',
    description:
      'List the plugin templates this bundle ships, with the file each kind writes and the runtime it runs in (Bun plugin host, moejs inside magpie, or the page frame). Use it to find a reference implementation of a plugin kind before writing one by hand.',
    parameters: {
      kind: { type: 'string', enum: Object.keys(KINDS), description: 'Only this kind.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args) {
      const lines = [`templates: ${join(PACKAGE_ROOT, 'templates')}`, '']
      for (const [kind, info] of Object.entries(KINDS)) {
        if (args.kind && args.kind !== kind) continue
        // The scaffold takes @author/name now; the sample only shows the shape.
        const plan = planFiles({ kind, packageName: `@demo/${info.suffix.replace('<name>', 'demo')}`, description: 'demo' })
        lines.push(`${kind} — ${info.what}`)
        lines.push(`  runtime: ${info.runtime}; entry: ${info.entry}; name: @author/${info.suffix}`)
        lines.push(`  files: ${plan.map((file) => file.rel).join(', ')}`)
      }
      return lines.join('\n')
    },
  })

  register({
    name: 'magpie_registry_entry',
    description:
      'The registry.json entry a package should carry, checked against what magpie\'s Plugins page reads: one value of the wrong type (providers as a string, community as a string, an unknown kind or field) loses every listing, not just its own. Use it before opening a pull request to the community repository, or before publishing your own plugin.',
    parameters: {
      dir: { type: 'string', required: true, description: 'The package directory (the folder holding package.json).' },
      summaryZh: { type: 'string', description: 'The Chinese one-liner for the card. Both languages are required.' },
      providers: { type: 'array', items: { type: 'string' }, description: 'For a provider: the provider ids it signs in to (e.g. acme).' },
      icon: { type: 'string', description: 'An https:// or data:image/ icon, or a bundled icon name.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args) {
      const dir = resolve(String(args.dir ?? ''))
      if (!existsSync(dir)) throw new Error(`${dir} does not exist`)
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      const report = checkPackage(dir)
      const entry = registryEntry(manifest, report.kinds, {
        summaryZh: args.summaryZh ?? '',
        providers: args.providers,
        icon: args.icon,
      })
      const problems = registryProblems(JSON.stringify({ version: 1, plugins: [entry] }))
      const lines = [JSON.stringify(entry, null, 2), '']
      if (problems.length) {
        for (const problem of problems) lines.push(`✗ ${problem}`)
        lines.push('')
        lines.push('fill in summary.zh and the providers before opening a pull request')
      } else {
        lines.push('✓ magpie reads it whole; paste it into registry.json')
      }
      return lines.join('\n')
    },
  })
}
