/**
 * Validation for published artifacts and for action arguments.
 *
 * The profile requires a runtime to reject a malformed network before any model call:
 * duplicate or missing agent references, an invalid front agent, unsupported executable
 * definitions. These functions are pure so they can run in tests and in the page's
 * conformance panel.
 */
import type { AgentDef, AgentManifest, JsonSchema, ManifestNetworkEntry, NetworkDef } from './types'

export interface Validation {
  ok: boolean
  errors: string[]
}

const ok = (): Validation => ({ ok: true, errors: [] })
const fail = (errors: string[]): Validation => ({ ok: false, errors })

const isHttp = (s: string) => /^https?:\/\//i.test(s)

export function validateManifest(raw: unknown): Validation {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return fail(['manifest: not a JSON object'])
  const m = raw as AgentManifest
  if (!Array.isArray(m.networks) || m.networks.length === 0) {
    errors.push('manifest.networks: must be a non-empty array')
  } else {
    const seen = new Set<string>()
    m.networks.forEach((n, i) => {
      if (!n || typeof n !== 'object') {
        errors.push(`manifest.networks[${i}]: not an object`)
        return
      }
      if (!n.name) errors.push(`manifest.networks[${i}].name: missing`)
      if (!n.front_man) errors.push(`manifest.networks[${i}].front_man: missing`)
      if (!n.hocon) errors.push(`manifest.networks[${i}].hocon: missing`)
      if (n.name && seen.has(n.name)) errors.push(`manifest.networks[${i}].name: duplicate "${n.name}"`)
      if (n.name) seen.add(n.name)
    })
  }
  if (m.peer_policy && m.peer_policy.mode && !['open', 'closed'].includes(m.peer_policy.mode)) {
    errors.push('manifest.peer_policy.mode: must be "open" or "closed"')
  }
  return errors.length ? fail(errors) : ok()
}

export type ResolvedNetwork = ManifestNetworkEntry & { url: string }

/**
 * Select the entry whose name exactly matches. The profile forbids falling back to a
 * different published network, so a near miss is a failure with a helpful message.
 */
export function resolveNetworkEntry(
  manifest: AgentManifest,
  name: string,
  base: string,
): { ok: true; entry: ResolvedNetwork } | { ok: false; error: string } {
  const networks = manifest.networks ?? []
  const exact = networks.find((n) => n.name === name)
  if (exact) {
    const url = new URL(exact.hocon, base.endsWith('/') ? base : base + '/').toString()
    return { ok: true, entry: { ...exact, url } }
  }
  const near = networks.map((n) => n.name).join(', ') || '(none)'
  return {
    ok: false,
    error: `No published network named "${name}" at this site. Published: ${near}. The runtime does not substitute another network.`,
  }
}

const RESERVED_TOOL_PREFIX = 'website_'

export function validateNetwork(raw: unknown, frontMan: string): Validation {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return fail(['network: not a JSON object'])
  const net = raw as NetworkDef
  if (!Array.isArray(net.tools) || net.tools.length === 0) {
    return fail(['network.tools: must be a non-empty array of agents'])
  }
  const names = new Set<string>()
  net.tools.forEach((a, i) => {
    const where = `network.tools[${i}]`
    if (!a || typeof a !== 'object') {
      errors.push(`${where}: not an object`)
      return
    }
    const agent = a as AgentDef
    if (!agent.name) errors.push(`${where}.name: missing`)
    else if (names.has(agent.name)) errors.push(`${where}.name: duplicate agent "${agent.name}"`)
    else names.add(agent.name)
    if (!agent.function?.description) errors.push(`${where}.function.description: missing`)
    if (agent.name?.startsWith(RESERVED_TOOL_PREFIX)) {
      errors.push(`${where}.name: "${RESERVED_TOOL_PREFIX}" is reserved for site actions`)
    }
    if (agent.tools && !Array.isArray(agent.tools)) errors.push(`${where}.tools: must be an array`)
    if (agent.function?.parameters && agent.function.parameters.type !== 'object') {
      errors.push(`${where}.function.parameters: must declare type "object"`)
    }
  })
  if (!names.has(frontMan)) {
    errors.push(`front_man "${frontMan}": no agent with that name in this network`)
  }
  // Second pass: every named reference must exist.
  net.tools.forEach((agent, i) => {
    for (const ref of agent.tools ?? []) {
      if (typeof ref === 'string') {
        if (!names.has(ref) && !isHttp(ref)) {
          errors.push(`network.tools[${i}].tools: "${ref}" is neither a sibling agent nor an http(s) URL`)
        }
      } else if (ref && typeof ref === 'object') {
        if (!isHttp(ref.url ?? '')) errors.push(`network.tools[${i}].tools: MCP entry needs an http(s) url`)
      }
    }
  })
  return errors.length ? fail(errors) : ok()
}

/** Validate arguments against a JSON Schema subset. Returns human-readable errors. */
export function validateArgs(schema: JsonSchema | undefined, value: unknown): Validation {
  const errors: string[] = []
  walk(schema, value, '$', errors)
  return errors.length ? fail(errors) : ok()
}

function walk(schema: JsonSchema | undefined, value: unknown, path: string, errors: string[]): void {
  if (!schema) return
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`)
    return
  }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected an object`)
        return
      }
      const obj = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined) errors.push(`${path}.${key}: required`)
      }
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(schema.properties ?? {}))
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) errors.push(`${path}.${key}: not allowed by this action`)
        }
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (obj[key] !== undefined) walk(sub, obj[key], `${path}.${key}`, errors)
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected an array`)
        return
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: at most ${schema.maxItems} items`)
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: at least ${schema.minItems} items`)
      }
      value.forEach((item, i) => walk(schema.items, item, `${path}[${i}]`, errors))
      return
    }
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${path}: expected a string`)
        return
      }
      if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push(`${path}: expected a date as YYYY-MM-DD`)
      }
      if (schema.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        errors.push(`${path}: expected an email address`)
      }
      return
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${path}: expected a number`)
        return
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${path}: expected an integer`)
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: must be at least ${schema.minimum}`)
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: must be at most ${schema.maximum}`)
      }
      return
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected true or false`)
      return
    default:
      return
  }
}
