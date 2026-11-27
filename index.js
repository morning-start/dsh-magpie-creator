/**
 * Host half of `dsh-magpie-creator`.
 *
 * The capability half lives in `./tools`, which the bundle patch mounts inside
 * the Magpie mode preset (`preset-magpie`) only. This row exists so the bundle
 * has a stable Host-level identity in Plugin Manager, and it is where the
 * Magpie-mode tools read shared state from.
 *
 * It registers no tool, prompt section or service of its own, so loading this
 * bundle changes nothing for any other preset. Anything added here later must
 * be registered inside `ctx.effect(...)` so unloading the bundle removes it.
 */

export const name = 'magpie'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  void ctx
}
