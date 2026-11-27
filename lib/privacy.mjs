// Scanning a repository for the things an author leaves behind: their home
// folder, their email, their machine, a token.
//
// This runs before publishing, because a published package and a public
// repository are both permanent. The rules are deliberately narrow — each one
// is a shape that is personal rather than merely descriptive — so a README that
// says `~/.config/magpie` or `C:\Program Files` is not flagged for naming a
// path, while a path holding the author's own user name is.
//
// Read-only: nothing here writes, and nothing here reads outside the repository.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Files and folders that are never part of what is published. */
const SKIP = new Set(['node_modules', '.git', 'tmp', 'sandboxes', 'coverage', 'dist', '.idea', '.vscode'])
/** Extensions worth reading as text. */
const TEXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml', '.txt', '.html', '.css', '.svg', '.sh', '.ps1'])

/**
 * A finding is `fail` when it is a credential or the author's own identity in
 * shipped content, and `warn` when it is a plausible but unproven smell.
 */
const RULES = [
  {
    id: 'credential',
    level: 'fail',
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,})/,
    message: 'looks like a credential',
  },
  {
    id: 'home-path',
    level: 'fail',
    pattern: /(?:[A-Za-z]:\\Users\\(?!<|\{)[^\\\s"'`]+\\|\/Users\/(?!<|\{)[^/\s"'`]+\/|\/home\/(?!<|\{)[^/\s"'`]+\/)/,
    message: 'holds a real home folder path',
  },
  {
    id: 'author-email',
    level: 'warn',
    pattern: '\u0000AUTHOR\u0000',
    message: 'names the author\u2019s own email',
  },
]

/**
 * Scan a repository's working tree.
 * @param {string} root the repository folder
 * @param {{ authorEmails?: string[], include?: (file: string) => boolean }} [options]
 *        `authorEmails` are addresses that must not appear; `include` limits
 *        which relative paths are read (default: every text file).
 * @returns {{ findings: { file: string, line: number, rule: string, level: string, message: string, text: string }[], scanned: number, skipped: string[] }}
 */
export function scanPrivacy(root, { authorEmails = [], include } = {}) {
  const dir = resolve(root)
  const findings = []
  const skipped = []
  let scanned = 0
  const emails = authorEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)

  for (const file of walk(dir)) {
    const rel = relative(dir, file).split(sep).join('/')
    if (include && !include(rel)) {
      skipped.push(rel)
      continue
    }
    const ext = file.slice(file.lastIndexOf('.'))
    if (!TEXT.has(ext)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (text.includes('\u0000')) continue
    scanned += 1
    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.id === 'author-email') {
          const lower = line.toLowerCase()
          const hit = emails.find((email) => lower.includes(email))
          if (hit) {
            findings.push({ file: rel, line: index + 1, rule: rule.id, level: rule.level, message: rule.message, text: redact(line, hit) })
          }
          continue
        }
        const match = rule.pattern.exec(line)
        if (match) {
          findings.push({ file: rel, line: index + 1, rule: rule.id, level: rule.level, message: rule.message, text: redact(line, match[0]) })
        }
      }
    })
  }
  return { findings, scanned, skipped }
}

/** Every file under a folder, skipping what is never published. */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const stats = statSync(full)
    if (stats.isDirectory()) out.push(...walk(full))
    else if (stats.isFile() && stats.size < 2_000_000) out.push(full)
  }
  return out
}

/** A line with the matched secret or name masked, so the report is not a leak. */
function redact(line, value) {
  if (!value) return line.trim().slice(0, 120)
  const masked = value.length <= 8 ? '***' : `${value.slice(0, 3)}…${value.slice(-2)}`
  return line.replace(value, masked).trim().slice(0, 120)
}