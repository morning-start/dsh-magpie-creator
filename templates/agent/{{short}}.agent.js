// {{title}} — an agent on magpie's Agents page.
//
// Runs inside magpie's own process on moejs: one file, relative imports only,
// no timers, no fetch, no Node APIs. magpie writes the model into the agent's
// own config file, beside the gateway address and a key of the agent's own, and
// puts every key back when the user switches the agent off or picks its own
// model again.
export const agent = {
  // Lower-case letters, digits, . _ and -; not one of magpie's own agents.
  id: '{{id}}',
  name: '{{title}}',
  // The file magpie edits. ~ and $VAR are expanded; it is made when missing.
  config: '~/.{{id}}/config.json',
  // The key of the model in it, as a dotted path (JSON, YAML, TOML).
  model: 'model',
  // Written before magpie's model id, for an agent that reaches
  // OpenAI-compatible endpoints through LiteLLM.
  // prefix: 'openai/',
  // The command on PATH and the folder that say the agent is installed.
  bin: '{{id}}',
  // Words of the agent's User-Agent, to name its requests in Usage.
  ua: ['{{id}}'],
  notice: '{{title}} reads its settings when it starts: restart it to use the new model.',
}

/**
 * The other keys to write beside the model.
 * @param {{ gateway: { url: string, v1: string, key: string }, model: { id: string, name: string } }} input
 */
export function connect({ gateway, model }) {
  return {
    base_url: gateway.v1,
    api_key: gateway.key,
    model: model.id,
  }
}
