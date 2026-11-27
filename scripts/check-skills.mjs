#!/usr/bin/env node
// Check the skills this bundle ships: each is a folder with a SKILL.md whose
// front matter has a name matching the folder and a description that says when
// to use it.
//
//   node scripts/check-skills.mjs [<repo dir>]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skillsDir = join(resolve(process.argv[2] ?? resolve(here, '..')), 'skills')
if (!existsSync(skillsDir)) {
  console.error(`no skills/ at ${skillsDir}`)
  process.exit(2)
}

const problems = []
for (const name of readdirSync(skillsDir)) {
  const dir = join(skillsDir, name)
  if (!statSync(dir).isDirectory()) continue
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) {
    problems.push(`${name}: no SKILL.md`)
    continue
  }
  const text = readFileSync(file, 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!front) {
    problems.push(`${name}: no front matter`)
    continue
  }
  const field = (key) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(front[1])?.[1]?.trim()
  const declared = field('name')
  const description = field('description')
  if (declared !== name) problems.push(`${name}: name is ${declared ?? '(missing)'}, not the folder name`)
  if (!description) problems.push(`${name}: no description`)
  else if (description.length < 60) problems.push(`${name}: description is short (${description.length} chars); say when to use it`)
  if (!/^#\s/m.test(text)) problems.push(`${name}: no heading`)
  console.log(`✓ ${name} (${text.length} chars)`)
}

for (const problem of problems) console.error(`✗ ${problem}`)
process.exit(problems.length ? 1 : 0)
