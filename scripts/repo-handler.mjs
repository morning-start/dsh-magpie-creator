#!/usr/bin/env node
// Create — or update — the GitHub repository a scaffolded magpie plugin lives in.
//
//   node scripts/repo-handler.mjs <包目录> [--owner <login>] [--name <repo>] [--private] [--dry-run]
//
// Create: the directory has no origin yet; a public repository is created and
// pushed. Update: the directory already points at a GitHub repository; its
// visibility is set to public and its topic is added. Both states end with the
// `magpie-plugin` topic (what Discover reads) and package.json's `repository`
// pointing at the repository npm provenance will record.
import { handleRepo, TOPIC } from '../lib/repo.mjs'

function parseArgs(argv) {
  const out = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      out._.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (key === 'private' || key === 'dry-run') {
      out[key === 'dry-run' ? 'dryRun' : 'private'] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`)
    out[key] = value
    index += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const dir = args._[0] ?? '.'
try {
  const result = handleRepo({
    dir,
    owner: args.owner,
    name: args.name,
    privateRepo: args.private,
    dryRun: args.dryRun,
  })
  console.log(`repository: ${result.repo} (${result.action}, ${result.private ? 'private' : 'public'}, topic ${TOPIC})`)
  if (result.action === 'updated') {
    console.log(result.dryRun
      ? 'already existed: would align visibility, topic and package.json repository; nothing is pushed'
      : 'already existed: visibility, topic and package.json repository were aligned; nothing was pushed')
  }
  console.log(`${result.dryRun ? 'would run' : 'ran'}:`)
  for (const command of result.commands) console.log(`  ${command}`)
  if (result.dryRun) {
    console.log('\ndry run: nothing was created or written')
  } else {
    console.log('\nnext: push your commits, then `git tag v0.1.1 && git push --follow-tags` to publish')
  }
} catch (error) {
  console.error(error.message)
  process.exit(1)
}