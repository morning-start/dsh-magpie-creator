// registry.json — the list magpie's Plugins page suggests. One wrong type in
// one entry loses every listing, so the rules are worth pinning down.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { displayName, registryEntry, registryKind, registryProblems, searchableProvider } from '../lib/registry.mjs'

const good = (over = {}) => ({
  package: '@magpie-community/opencode-acme-auth',
  name: 'Acme',
  providers: ['acme'],
  summary: { en: 'Your Acme Coding Plan.', zh: '使用你的 Acme Coding Plan。' },
  ...over,
})
const file = (plugins) => JSON.stringify({ version: 1, plugins })

describe('a registry magpie reads whole', () => {
  test('one good provider entry', () => {
    assert.deepEqual(registryProblems(file([good()])), [])
  })

  test('a middleware entry has a kind and no providers', () => {
    assert.deepEqual(registryProblems(file([{ package: '@magpie-community/middleware-x', name: 'X', kind: 'middleware', summary: { en: 'a', zh: 'a' } }])), [])
  })

  test('a community entry may say community: true', () => {
    assert.deepEqual(registryProblems(file([good({ community: true })])), [])
  })
})

describe('what loses every listing', () => {
  test('a wrong version', () => {
    assert.match(registryProblems(JSON.stringify({ version: 2, plugins: [good()] })).join(), /version 2, not 1/)
  })

  test('providers as a string', () => {
    assert.match(registryProblems(file([good({ providers: 'acme' })])).join(), /providers is not a list/)
  })

  test('community as a string', () => {
    assert.match(registryProblems(file([good({ community: 'true' })])).join(), /community is not true or false/)
  })

  test('an unknown kind', () => {
    assert.match(registryProblems(file([good({ kind: 'provider' })])).join(), /kind "provider" is not one of/)
  })

  test('an unknown field', () => {
    assert.match(registryProblems(file([good({ homepage: 'https://x' })])).join(), /unknown field "homepage"/)
  })

  test('a missing language', () => {
    assert.match(registryProblems(file([good({ summary: { en: 'a' } })])).join(), /no summary\.zh/)
  })

  test('a package listed twice', () => {
    assert.match(registryProblems(file([good(), good()])).join(), /package listed again/)
  })

  test('an icon that is neither https nor data:image', () => {
    assert.match(registryProblems(file([good({ icon: 'http://x/icon.svg' })])).join(), /is not https or data:image/)
    assert.deepEqual(registryProblems(file([good({ icon: 'githubcopilot' })])), [])
    assert.deepEqual(registryProblems(file([good({ icon: 'https://x/icon.svg' })])), [])
  })

  test('text that is only whitespace', () => {
    assert.match(registryProblems(file([good({ name: '   ' })])).join(), /no name/)
  })

  test('not JSON, or not an object', () => {
    assert.match(registryProblems('{').join(), /is not JSON/)
    assert.match(registryProblems('[]').join(), /is not an object/)
  })
})

describe('the entry a package should carry', () => {
  test('a provider has providers and no kind', () => {
    const entry = registryEntry({ name: '@magpie-community/opencode-acme-auth', description: 'd' }, ['provider'], { providers: ['acme'], summaryZh: 'z' })
    assert.deepEqual(entry, {
      package: '@magpie-community/opencode-acme-auth',
      name: 'acme',
      community: true,
      providers: ['acme'],
      summary: { en: 'd', zh: 'z' },
    })
    assert.deepEqual(registryProblems(file([entry])), [])
  })

  test('every non-provider kind maps to the registry kind', () => {
    assert.equal(registryKind(['middleware']), 'middleware')
    assert.equal(registryKind(['routing']), 'middleware')
    assert.equal(registryKind(['tools']), 'tools')
    assert.equal(registryKind(['page']), 'page')
    assert.equal(registryKind(['agent']), 'agent')
    assert.equal(registryKind(['hooks']), 'hooks')
    assert.equal(registryKind(['provider']), undefined)
  })

  test('the display name is the community short name', () => {
    assert.equal(displayName('@magpie-community/opencode-acme-auth'), 'acme')
    assert.equal(displayName('@magpie-community/middleware-model-map'), 'model-map')
    assert.equal(displayName('@magpie-community/page-usage'), 'usage')
  })

  test('the entry it builds passes the reader', () => {
    for (const [kinds, pkg] of [
      [['middleware'], { name: '@magpie-community/middleware-x', description: 'm' }],
      [['tools'], { name: '@magpie-community/tools-x', description: 't' }],
      [['page'], { name: '@magpie-community/page-x', description: 'p' }],
      [['agent'], { name: '@magpie-community/agent-x', description: 'a' }],
      [['hooks'], { name: '@magpie-community/gateway-x', description: 'h' }],
    ]) {
      const entry = registryEntry(pkg, kinds, { summaryZh: '中文' })
      assert.deepEqual(registryProblems(file([entry])), [], JSON.stringify(entry))
    }
  })
})

describe('whether the Plugins search finds a provider', () => {
  test('needs opencode and one of auth/plugin/provider', () => {
    assert.equal(searchableProvider({ name: 'opencode-acme-auth', keywords: [] }), true)
    assert.equal(searchableProvider({ name: '@x/acme', keywords: ['opencode', 'opencode-plugin'] }), true)
    assert.equal(searchableProvider({ name: '@x/acme', keywords: ['opencode'] }), false)
    assert.equal(searchableProvider({ name: '@x/acme', keywords: ['magpie', 'auth'] }), false)
    assert.equal(searchableProvider({ name: '@x/acme' }), false)
  })
})
