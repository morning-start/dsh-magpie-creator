// {{title}} — asynchronous gateway request hooks.
//
// These run in magpie's Bun host, once per agent request, before the JS gateway
// middleware, for every provider. Unlike middleware they may await I/O (a
// service, a file, a database), and unlike middleware they cannot turn a
// request away: return an object to replace the request, or undefined to keep it.
//
// Changing the model, streaming, the client's tools or its tool choice is
// rolled back as a failure. Each hook has one second by default
// (gatewayTimeoutMs: 100..30000 in the plugin's options).
//
// ctx: { protocol, model, stream, path, agent, caller, session, cwd, query,
//        options, signal }
// ctx.query is the latest user text, without tool results or images;
// ctx.caller is { agent, name, via }. No authorization header is ever passed in.

/**
 * Before the request is routed.
 * @param {any} body the agent API request object
 * @param {any} ctx the request's context
 * @returns {any | undefined} a replacement body, or nothing
 */
export async function onRequest(body, ctx) {
  if (!ctx?.query) return undefined
  const options = ctx.options ?? {}
  if (!options.prefix) return undefined
  // Example: put a project line in front of the latest user text.
  const messages = Array.isArray(body?.messages) ? body.messages : null
  if (!messages?.length) return undefined
  const last = messages[messages.length - 1]
  if (last?.role !== 'user' || typeof last.content !== 'string') return undefined
  last.content = `${options.prefix}\n\n${last.content}`
  return body
}

/**
 * After the reply finished. Best effort: it cannot change the reply and never
 * holds the live stream.
 * @param {any} reply the reply
 * @param {any} ctx the request's context
 */
export async function onResponse(reply, ctx) {
  void reply
  void ctx
}

/**
 * An account that has to be signed in again. Told once until it works again,
 * and it carries no token.
 * @param {{ provider: string, providerName: string, account: string, state: 'signed-out' | 'ending', endsAt?: string }} event
 */
export async function onSignIn(event) {
  void event
}
