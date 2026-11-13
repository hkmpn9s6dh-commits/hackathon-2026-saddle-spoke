import { describe, expect, it } from 'vitest'
import { resolveNetworkEntry, validateArgs, validateManifest, validateNetwork } from '../src/runtime/validate'
import type { AgentManifest, NetworkDef } from '../src/runtime/types'

const manifest: AgentManifest = {
  networks: [{ name: 'shop', front_man: 'desk', hocon: './shop.network.json' }],
}

const network: NetworkDef = {
  tools: [
    { name: 'desk', function: { description: 'the front desk' }, tools: ['bench'] },
    { name: 'bench', function: { description: 'the bench' }, tools: [] },
  ],
}

describe('manifest', () => {
  it('accepts a published manifest', () => {
    expect(validateManifest(manifest).ok).toBe(true)
  })

  it('rejects a manifest with no networks', () => {
    const r = validateManifest({ networks: [] })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('non-empty')
  })

  it('resolves a network by exact name only', () => {
    const hit = resolveNetworkEntry(manifest, 'shop', 'https://a.example/')
    expect(hit.ok).toBe(true)
    if (hit.ok) expect(hit.entry.url).toBe('https://a.example/shop.network.json')

    const miss = resolveNetworkEntry(manifest, 'shoppe', 'https://a.example/')
    expect(miss.ok).toBe(false)
    if (!miss.ok) expect(miss.error).toContain('does not substitute')
  })
})

describe('network', () => {
  it('accepts a two-agent network', () => {
    expect(validateNetwork(network, 'desk').ok).toBe(true)
  })

  it('rejects duplicate agent names', () => {
    const bad: NetworkDef = { tools: [{ name: 'a', function: { description: 'x' } }, { name: 'a', function: { description: 'y' } }] }
    const r = validateNetwork(bad, 'a')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('duplicate')
  })

  it('rejects a front man that does not exist', () => {
    const r = validateNetwork(network, 'nobody')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('front_man')
  })

  it('rejects a reference that is neither a sibling nor a URL', () => {
    const bad: NetworkDef = { tools: [{ name: 'a', function: { description: 'x' }, tools: ['ghost'] }] }
    const r = validateNetwork(bad, 'a')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('neither')
  })

  it('rejects a reserved website_ prefix', () => {
    const bad: NetworkDef = { tools: [{ name: 'website_thing', function: { description: 'x' } }] }
    const r = validateNetwork(bad, 'website_thing')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('reserved')
  })
})

describe('action arguments', () => {
  const schema = {
    type: 'object' as const,
    properties: {
      part: { type: 'string' as const, enum: ['rear_derailleur', 'chain'] },
      qty: { type: 'integer' as const, minimum: 1, maximum: 5 },
      when: { type: 'string' as const, format: 'date' },
    },
    required: ['part', 'qty'],
    additionalProperties: false,
  }

  it('accepts valid arguments', () => {
    expect(validateArgs(schema, { part: 'chain', qty: 2 }).ok).toBe(true)
  })

  it('rejects a value outside the enum', () => {
    const r = validateArgs(schema, { part: 'saddle', qty: 1 })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('must be one of')
  })

  it('rejects a missing required field', () => {
    const r = validateArgs(schema, { part: 'chain' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('required')
  })

  it('rejects an extra field when additionalProperties is false', () => {
    const r = validateArgs(schema, { part: 'chain', qty: 1, contact: '+44' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('not allowed')
  })

  it('rejects a malformed date', () => {
    const r = validateArgs(schema, { part: 'chain', qty: 1, when: 'next Thursday' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('YYYY-MM-DD')
  })

  it('rejects a number above the maximum', () => {
    const r = validateArgs(schema, { part: 'chain', qty: 9 })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('at most')
  })
})
