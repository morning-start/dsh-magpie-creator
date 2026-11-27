// Runs strategies.json the way magpie's gateway asks a strategy for an order:
// the pool's name, the seats (with every field a seat has) and the plugin's
// options; an answer that is not a permutation of the seats is the listed
// order, as the gateway falls back to.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import * as mod from './{{short}}.gateway.js'

const cases = JSON.parse(readFileSync(join(import.meta.dir, 'strategies.json'), 'utf8'))

function order(name, pool, seats, options = {}) {
  const m = mod.default ?? mod
  const s = m.strategies?.[name]
  const fn = typeof s === 'function' ? s : s?.order
  if (typeof fn !== 'function') throw new Error(`no strategy ${name}`)
  const full = seats.map((seat, index) => ({
    key: `seat-${index}`, account: false, known: false, learns: false, used: 0,
    soon: [], pace: 0, weight: 1, resting: false, tokens: 0, ...seat,
  }))
  const listed = full.map((_, index) => index)
  let got
  try {
    got = fn(pool, JSON.parse(JSON.stringify(full)), options)
  } catch {
    return { order: listed, failed: true }
  }
  const ok = Array.isArray(got) && got.length === full.length
    && got.every((i) => Number.isInteger(i) && i >= 0 && i < full.length)
    && new Set(got).size === full.length
  return ok ? { order: got } : { order: listed, failed: true }
}

for (const c of cases) {
  test(c.name, () => {
    const got = order(c.strategy, c.pool ?? 'test-pool', c.seats, c.options ?? {})
    expect(got.failed).toBeUndefined()
    expect(got.order.map((i) => c.seats[i].key ?? i)).toEqual(c.expect)
  })
}
