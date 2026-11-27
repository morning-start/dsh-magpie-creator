// {{title}} — tools for every agent.
//
// magpie serves these on its own MCP server, /mcp/magpie/tools (Streamable
// HTTP), and names each one <plugin>_<tool>: `{{short}}_echo` below. Any agent
// that takes an MCP server can call them.
//
// Export ONE async plugin function that returns a `tool` hook. Every function
// the module exports is taken as a plugin, so helpers go in another file.
// `args` is JSON Schema; magpie checks a call against it before execute runs.
// A string result is sent as text, anything else as its JSON.
export const {{pascal}}Tools = async () => ({
  tool: {
    echo: {
      description:
        'Echoes the text back, with the time it took. Replace this with a real tool: say what it does and when a model should call it.',
      args: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'the text to echo' },
        },
        required: ['text'],
      },
      async execute(args, ctx) {
        if (typeof args?.text !== 'string') throw new Error('text is a string')
        // ctx.agent is the agent that called; ctx.abort fires at 55 seconds.
        return { echo: args.text, agent: ctx?.agent ?? null, at: new Date().toISOString() }
      },
    },
  },
})
