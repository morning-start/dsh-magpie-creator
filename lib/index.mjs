// The lib half of dsh-magpie-creator: everything the tools, the scripts and the
// skills share. Plain ESM, no dependencies, Node 20+ built-ins only, so the same
// code runs inside the DSH Host and from `node scripts/…`.
export {
  locateMagpie, runMagpie, magpieVersion, magpieStatus, gatewayUrl, configDir, DEFAULT_PORTS,
} from './magpie.mjs'
export {
  checkPackage, summarize, kindsOf, providerEntry, listFiles, KIND_OF,
} from './check.mjs'
export { scaffold, KINDS, kindFromName, planFiles } from './scaffold.mjs'
export { sandboxCommand, sandboxEnv, sandboxPaths, readSandboxState, writeSandboxState } from './sandbox.mjs'
export { doctor } from './doctor.mjs'
