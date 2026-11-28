import { expect, test } from 'bun:test'
import { onRequest, onResponse, onSignIn } from './{{short}}.hooks.mjs'

const ctx = (options = {}) => ({
  protocol: 'chat', model: 'deepseek/deepseek-chat', stream: false, path: '/v1/chat/completions',
  agent: 'claude', caller: { agent: 'claude', name: 'Claude Code', via: [] }, session: 's1',
  cwd: '/tmp', query: 'fix the test', options, signal: new AbortController().signal,
})

// A message the way an agent API sends it: a role, its content, and the id the
// client assigned. The id is not decoration — DSH refuses to load a session
// whose messages lack one, and a fixture that omits it teaches the wrong shape.
const userMessage = (content) => ({ id: 'msg_user', role: 'user', content })

test('a request with nothing to add is kept as it came', async () => {
  const body = { model: 'deepseek/deepseek-chat', messages: [userMessage('hi')] }
  expect(await onRequest(body, ctx())).toBeUndefined()
})

test('the prefix goes in front of the latest user text', async () => {
  const body = { model: 'deepseek/deepseek-chat', messages: [userMessage('hi')] }
  const out = await onRequest(body, ctx({ prefix: 'Project: acme' }))
  expect(out.messages.at(-1).content).toBe('Project: acme\n\nhi')
})

test('a request without user text is left alone', async () => {
  const body = { model: 'deepseek/deepseek-chat', messages: [{ id: 'msg_asst', role: 'assistant', content: 'hi' }] }
  expect(await onRequest(body, ctx({ prefix: 'x' }))).toBeUndefined()
})

test('the reply and sign-in hooks exist and do not throw', async () => {
  await expect(onResponse({}, ctx())).resolves.toBeUndefined()
  await expect(onSignIn({ provider: 'acme', providerName: 'Acme', account: 'a@b.c', state: 'signed-out' })).resolves.toBeUndefined()
})
