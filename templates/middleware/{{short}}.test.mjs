// Runs cases.json the way magpie's gateway calls this middleware: one ctx per
// request (so ctx.state carries over), each body a fresh copy, undefined
// keeping what came in and null dropping an event.
//
// `bun test` runs this file. The same cases.json can be run by the community
// repository's scripts/middleware.mjs, so a package that moves there keeps its
// cases.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import * as mod from './{{short}}.middleware.js'

const cases = JSON.parse(readFileSync(join(import.meta.dir, 'cases.json'), 'utf8'))
const copy = (value) => JSON.parse(JSON.stringify(value))

async function run(c) {
  const m = mod.default ?? mod
  let rejected
  const ctx = {
    protocol: 'anthropic', model: '', stream: false, path: '', ...c.ctx,
    options: c.options ?? {}, state: {},
    reject(status, message) { rejected ??= { status, message } },
  }
  const out = {}
  if (c.request) {
    const r = m.onRequest ? await m.onRequest(copy(c.request), ctx) : undefined
    if (rejected) out.reject = rejected
    else out.request = r === undefined ? c.request : copy(r)
    if (!rejected && c.provider && m.onProvider) {
      const p = await m.onProvider(copy(out.request), { ...ctx, provider: c.provider })
      if (p !== undefined && p !== null) out.request = copy(p)
    }
  }
  if (c.events) {
    out.events = []
    for (const e of c.events) {
      const wants = !m.events || (e.event && m.events.includes(e.event))
      if (typeof e.data !== 'object' || !m.onEvent || !wants) {
        out.events.push(e.data)
        continue
      }
      const r = await m.onEvent(copy(e.data), ctx)
      if (r === null) continue
      out.events.push(r === undefined ? e.data : copy(r))
    }
  }
  if (c.response) {
    ctx.status = c.status ?? 200
    const r = m.onResponse ? await m.onResponse(copy(c.response), ctx) : undefined
    out.response = r === undefined ? c.response : copy(r)
  }
  return out
}

for (const c of cases) {
  test(c.name, async () => {
    const got = await run(c)
    if (c.reject) {
      expect(got.reject?.status).toBe(c.reject.status)
      if (c.reject.message) expect(got.reject?.message).toContain(c.reject.message)
    } else {
      expect(got.reject).toBeUndefined()
      if (c.request) expect(got.request).toEqual(c.expect_request ?? c.request)
    }
    if (c.events) expect(got.events).toEqual(c.expect_events ?? c.events.map((e) => e.data))
    if (c.response) expect(got.response).toEqual(c.expect_response ?? c.response)
  })
}
