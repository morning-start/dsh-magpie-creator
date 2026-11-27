import { expect, test } from 'bun:test'
import { {{pascal}}Tools } from './index.mjs'

const { tool } = await {{pascal}}Tools({})
// The host calls execute(args, ctx); these tools need nothing from ctx.
const call = (name, args) => tool[name].execute(args, { agent: 'test', abort: AbortSignal.timeout(5000) })

test('gives tools with a JSON Schema and an execute', () => {
  expect(Object.keys(tool).length).toBeGreaterThan(0)
  for (const [name, t] of Object.entries(tool)) {
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,48}$/)
    expect(t.description.length).toBeGreaterThan(40)
    expect(t.args.type).toBe('object')
    expect(typeof t.execute).toBe('function')
  }
})

test('echo answers with what it was given', async () => {
  expect(await call('echo', { text: 'hi' })).toMatchObject({ echo: 'hi' })
})

test('a wrong argument is an error, not a guess', async () => {
  await expect(call('echo', { text: 42 })).rejects.toThrow('text is a string')
})
