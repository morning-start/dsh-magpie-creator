// {{title}} — magpie gateway middleware.
//
// This file runs inside magpie's own process on moejs, not on Bun: one file,
// relative imports only, no timers, no fetch, no Node APIs. It sees every
// request an agent sends and every event of the reply, whichever provider
// serves them. Bodies and events are in the agent's own API (ctx.protocol:
// anthropic, chat, responses or gemini), not the provider's.
//
// Hooks: onRequest, onAccount, onProvider, onEvent, onResponse. Return the
// object to send on, or nothing to send it on as it was. A hook that throws,
// takes longer than 250 ms (50 ms for an event) or returns something else is
// skipped, and the request goes on unchanged.

/** Only events of these names reach onEvent (Chat and Gemini events have none). */
// export const events = ['content_block_delta']

/**
 * Before routing: a new `body.model` routes the request elsewhere, and
 * ctx.reject(status, message) turns it away in the agent's own API.
 * @param {any} body the request body
 * @param {any} ctx { protocol, model, stream, path, agent, caller, options, state }
 */
export function onRequest(body, ctx) {
  ctx.state.asked = body.model
  const options = ctx.options ?? {}

  // Example: send a model alias to the real model.
  if (options.alias && body.model === options.alias.from) {
    body.model = options.alias.to
  }

  // Example: refuse a model the user listed.
  if (Array.isArray(options.blocked) && options.blocked.includes(body.model)) {
    return ctx.reject(403, `${body.model} is blocked by {{short}}`)
  }

  return body
}

/**
 * Each event of a streamed reply. Return null to leave the event out.
 * @param {any} event the event's data
 * @param {any} ctx the same ctx, with state shared across the request
 */
export function onEvent(event, ctx) {
  if (ctx.protocol === 'chat') {
    const choice = event.choices?.[0]
    const text = choice?.delta?.content
    if (typeof text === 'string' && text.includes('TODO')) {
      choice.delta.content = text.replaceAll('TODO', 'TO-DO')
    }
  }
  return event
}

/**
 * A reply that is not streamed, whole; ctx.status is its status.
 * @param {any} body the reply body
 * @param {any} ctx the same ctx
 */
export function onResponse(body, ctx) {
  void ctx
  return body
}
