import { expect, test } from 'bun:test'
import { _internal, {{pascal}}AuthPlugin } from './index.mjs'

// The host calls a plugin with its input and options; tests need neither.
const hooks = await {{pascal}}AuthPlugin({ client: { auth: { set: async () => {} }, app: { log: async () => {} } } })

test('declares the provider without overwriting a configured one', async () => {
  const cfg = {}
  await hooks.config(cfg)
  expect(cfg.provider[_internal.PROVIDER].name).toBeTruthy()
  expect(Object.keys(cfg.provider[_internal.PROVIDER].models).length).toBeGreaterThan(0)
  const kept = { provider: { [_internal.PROVIDER]: { name: 'Mine' } } }
  await hooks.config(kept)
  expect(kept.provider[_internal.PROVIDER].name).toBe('Mine')
})

test('offers an API-key sign-in', () => {
  expect(hooks.auth.provider).toBe(_internal.PROVIDER)
  expect(hooks.auth.methods.map((m) => m.type)).toContain('api')
  expect(typeof hooks.auth.loader).toBe('function')
})

test('the loader signs every request', async () => {
  const loaded = await hooks.auth.loader(async () => ({ type: 'api', key: 'k-1' }))
  expect(loaded.baseURL).toBe(_internal.BASE)
  const seen = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    seen.push({ input: String(input), headers: new Headers(init?.headers) })
    return new Response('{}', { status: 200 })
  }
  try {
    await loaded.fetch(`${_internal.BASE}/chat/completions`, { method: 'POST', body: '{}' })
  } finally {
    globalThis.fetch = realFetch
  }
  expect(seen[0].headers.get('authorization')).toBe('Bearer k-1')
})

test('a vendor that cannot be reached keeps the list magpie had', async () => {
  const provider = { models: { '{{id}}-chat': { name: 'Chat' } } }
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline') }
  try {
    await expect(hooks.provider.models(provider, { auth: { type: 'api', key: 'k' } })).rejects.toThrow('offline')
  } finally {
    globalThis.fetch = realFetch
  }
})
