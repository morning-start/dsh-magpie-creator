// {{title}} — a magpie provider plugin (OpenCode's v1 plugin shape).
//
// magpie loads this file into one Bun process, the plugin host, and calls every
// exported function as a plugin. Keep helpers off the top level: put them on
// `_internal` so `bun test` can reach them and magpie never calls them.
//
// Hooks magpie calls: config, auth (methods, loader, usage, refresh, checkin),
// provider.models and chat.headers. OpenCode ignores usage, refresh, checkin and
// the magpie.* fields, so this package also works there unchanged.
const PROVIDER = '{{id}}'
const BASE = '{{baseUrl}}'
const CLIENT = '{{packageName}}/0.1.0'

/** The model list before anyone signs in. Replace with what the vendor serves. */
const MODELS = {
  '{{id}}-chat': {
    name: '{{title}} Chat',
    limit: { context: 200000, output: 32000 },
    tool_call: true,
    reasoning: false,
  },
}

export const {{pascal}}AuthPlugin = async ({ client }) => ({
  // Declare the provider only when models.dev does not list this id. `??=`
  // keeps a provider the user configured in plugins.json.
  config: async (cfg) => {
    cfg.provider ??= {}
    cfg.provider[PROVIDER] ??= {
      name: '{{title}}',
      // The API the models speak: @ai-sdk/openai-compatible (chat completions),
      // @ai-sdk/openai (Responses), @ai-sdk/anthropic (Messages) or @ai-sdk/google.
      npm: '@ai-sdk/openai-compatible',
      api: BASE,
      models: MODELS,
    }
  },

  auth: {
    provider: PROVIDER,
    methods: [
      { type: 'api', label: '{{title}} API key', placeholder: '{{id}}-…' },
    ],

    // Runs once per account; runs again when that account's sign-in changes.
    async loader(getAuth) {
      const auth = await getAuth()
      if (auth?.type !== 'api') return {}
      return {
        baseURL: BASE,
        async fetch(input, init) {
          const headers = new Headers(init?.headers)
          headers.set('authorization', `Bearer ${auth.key}`)
          headers.set('x-client', CLIENT)
          const res = await fetch(input, { ...init, headers })
          // Tell magpie what a refusal means when the status alone is ambiguous:
          // X-Magpie-Sign-In: expired | kept | renewed (magpie strips it again).
          return res
        },
      }
    },

    // magpie's own hook: how much of the plan is used. Shown on the account,
    // in `magpie quota` and at GET /v1/magpie/quotas.
    async usage(getAuth) {
      const auth = await getAuth()
      if (auth?.type !== 'api') return { error: 'Sign in first' }
      const res = await fetch(`${BASE}/usage`, { headers: { authorization: `Bearer ${auth.key}` } })
      if (!res.ok) return { error: `{{title}} answered ${res.status}`, windows: [] }
      const u = await res.json()
      return {
        plan: u.plan,
        windows: [{ name: '5 hours', used: u.percent, resetsAt: u.resets_at, span: 5 * 3600 }],
      }
    },

    // Optional: let magpie renew the token (OAuth accounts only).
    // async refresh(auth, provider) {
    //   const t = await exchange(auth.refresh)
    //   if (t.error === 'invalid_grant') throw Object.assign(new Error('{{title}} refused the sign-in'), { signIn: 'expired' })
    //   return { access: t.access_token, refresh: t.refresh_token ?? auth.refresh, expires: Date.now() + t.expires_in * 1000 }
    // },

    // Optional: press the vendor's daily check-in. Never solve a captcha.
    // async checkin(getAuth) {
    //   const r = await claim((await getAuth()).access)
    //   return r.already ? { outcome: 'done' } : { outcome: 'claimed', credit: r.points }
    // },
  },

  // The models this account has, asked of the vendor. Return provider.models
  // unchanged when the vendor cannot be reached: magpie keeps the list it had.
  provider: {
    id: PROVIDER,
    async models(provider, { auth } = {}) {
      if (auth?.type !== 'api') return provider.models
      const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${auth.key}` } })
      if (!res.ok) return provider.models
      const { data } = await res.json()
      const base = provider.models['{{id}}-chat']
      return Object.fromEntries(data.map((m) => [m.id, { ...base, id: m.id, name: m.name ?? m.id }]))
    },
  },
})

/** Helpers for tests; magpie never calls anything on this object. */
export const _internal = {
  PROVIDER,
  BASE,
}
