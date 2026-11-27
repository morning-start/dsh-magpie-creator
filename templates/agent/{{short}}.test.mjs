import { expect, test } from 'bun:test'
import { agent, connect } from './{{short}}.agent.js'

const gateway = { url: 'http://127.0.0.1:3425', v1: 'http://127.0.0.1:3425/v1', key: 'magpie-{{id}}' }
const model = { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' }

test('the agent has an id magpie accepts and a config to write', () => {
  expect(agent.id).toMatch(/^[a-z0-9._-]+$/)
  expect(agent.config).toContain('~')
  expect(agent.model).toBeTruthy()
})

test('connect points the agent at the gateway', () => {
  const keys = connect({ gateway, model })
  expect(keys.base_url).toBe(gateway.v1)
  expect(keys.api_key).toBe(gateway.key)
  expect(keys.model).toBe(model.id)
})
