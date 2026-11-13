import { describe, expect, it } from 'vitest'
import { AgentRuntime, createActionRegistry, type SlyRule } from '../src/runtime/engine'
import type { ModelProvider, ModelToolSpec, NetworkDef, PeerLoader, SiteActionDef } from '../src/runtime/types'
import { createLocalPlanner, partFrom } from '../src/runtime/planner'
import { quoteRepair, dropoffSlots } from '../src/shop/data'

const registryWith = (actions: SiteActionDef[]) => {
  const reg = createActionRegistry()
  actions.forEach((a) => reg.register(a))
  return reg
}

const echoAction = (name: string, effect: 'read' | 'write', fn: (args: Record<string, unknown>) => unknown = () => ({ ok: true, data: {} })): SiteActionDef => ({
  name,
  description: name,
  effect,
  inputSchema: { type: 'object', properties: { x: { type: 'string' } }, additionalProperties: false },
  execute: (args) => fn(args) as { ok: boolean; data?: unknown },
})

const net = (agents: NetworkDef['tools']): NetworkDef => ({ tools: agents })

/** Calls whichever agent is next, so a run walks the whole chain. */
const providerThatDescends = (): ModelProvider => ({
  id: 'descend',
  label: 'descend',
  networked: false,
  async chat({ tools }: { tools: ModelToolSpec[] }) {
    const next = tools.find((t) => t.route.kind === 'agent')
    if (next) return { toolCalls: [{ id: '1', name: next.name, args: { request: 'go' } }] }
    return { text: 'end' }
  },
})

const providerThatCalls = (name: string, args: Record<string, unknown> = {}): ModelProvider => ({
  id: 'probe',
  label: 'probe',
  networked: false,
  async chat({ tools }: { tools: ModelToolSpec[] }) {
    if (tools.some((t) => t.name === name)) return { toolCalls: [{ id: '1', name, args }] }
    return { text: 'nothing to call' }
  },
})

describe('runtime budgets', () => {
  const chain = net(
    ['a', 'b', 'c', 'd'].map((name, i, all) => ({
      name,
      function: { description: name },
      tools: all[i + 1] ? [all[i + 1]] : [],
    })),
  )

  it('stops at the depth limit', async () => {
    const rt = new AgentRuntime({
      provider: providerThatDescends(),
      actions: createActionRegistry(),
      consent: { request: async () => true },
      budgets: { maxDepth: 2 },
    })
    const res = await rt.runNetwork({ network: chain, frontMan: 'a', request: 'go' })
    expect(res.error).toContain('Composition depth')
  })

  it('stops when the agent-call budget is spent', async () => {
    const rt = new AgentRuntime({
      provider: providerThatDescends(),
      actions: createActionRegistry(),
      consent: { request: async () => true },
      budgets: { maxCalls: 1, maxDepth: 9 },
    })
    const res = await rt.runNetwork({ network: chain, frontMan: 'a', request: 'go' })
    expect(res.error).toContain('budget')
  })

  it('rejects an invalid network before any model call', async () => {
    const rt = new AgentRuntime({
      provider: providerThatCalls('a'),
      actions: createActionRegistry(),
      consent: { request: async () => true },
    })
    await expect(rt.runNetwork({ network: net([{ name: 'a', function: { description: 'x' } }]), frontMan: 'b', request: 'go' })).rejects.toThrow(
      /front_man/,
    )
  })
})

describe('action results', () => {
  const one = net([{ name: 'desk', function: { description: 'desk' }, tools: [] }])

  it('reports a refusal without changing anything', async () => {
    const rt = new AgentRuntime({
      provider: providerThatCalls('website_thing', { x: 'a' }),
      actions: registryWith([echoAction('thing', 'read', () => ({ ok: false, reason: 'not in stock' }))]),
      consent: { request: async () => true },
    })
    const res = await rt.runNetwork({ network: one, frontMan: 'desk', request: 'go' })
    const row = res.events.find((e) => e.label === 'website_thing')
    expect(row?.status).toBe('refused')
  })

  it('reports an unknown outcome when a write throws, and refuses to repeat it', async () => {
    let calls = 0
    const rt = new AgentRuntime({
      provider: providerThatCalls('website_thing', { x: 'a' }),
      actions: registryWith([
        echoAction('thing', 'write', () => {
          calls += 1
          throw new Error('socket closed')
        }),
      ]),
      consent: { request: async () => true },
      budgets: { maxSteps: 3 },
    })
    const res = await rt.runNetwork({ network: one, frontMan: 'desk', request: 'go' })
    const rows = res.events.filter((e) => e.label === 'website_thing')
    expect(rows[0].status).toBe('unknown')
    // The second attempt is refused by the runtime, so the handler never runs twice.
    expect(calls).toBe(1)
    expect(rows.some((r) => r.status === 'refused')).toBe(true)
  })

  it('does not run a write the visitor cancelled', async () => {
    let calls = 0
    const rt = new AgentRuntime({
      provider: providerThatCalls('website_thing', { x: 'a' }),
      actions: registryWith([
        echoAction('thing', 'write', () => {
          calls += 1
          return { ok: true, data: {} }
        }),
      ]),
      consent: { request: async () => false },
      budgets: { maxSteps: 2 },
    })
    const res = await rt.runNetwork({ network: one, frontMan: 'desk', request: 'go' })
    expect(calls).toBe(0)
    expect(res.events.some((e) => e.kind === 'confirm' && e.status === 'denied')).toBe(true)
  })

  it('rejects bad arguments before the handler runs', async () => {
    let calls = 0
    const rt = new AgentRuntime({
      provider: providerThatCalls('website_thing', { wrong: 'a' }),
      actions: registryWith([
        echoAction('thing', 'read', () => {
          calls += 1
          return { ok: true, data: {} }
        }),
      ]),
      consent: { request: async () => true },
    })
    const res = await rt.runNetwork({ network: one, frontMan: 'desk', request: 'go' })
    expect(calls).toBe(0)
    expect(res.events.some((e) => e.status === 'refused')).toBe(true)
  })
})

describe('private context', () => {
  const peerNetwork: NetworkDef = {
    tools: [{ name: 'counter', function: { description: 'counter' }, tools: [] }],
  }
  const sameOriginPeer: PeerLoader = {
    async load(url: string) {
      return {
        base: url,
        origin: 'https://peer.example',
        networkName: 'counter',
        frontMan: 'counter',
        manifest: {},
        network: peerNetwork,
      }
    },
  }
  const rules: SlyRule[] = [{ destination: 'counter', fields: ['trade_account'] }]

  it('sends only named fields across the boundary and reports the rest as withheld', async () => {
    const network: NetworkDef = {
      tools: [{ name: 'desk', function: { description: 'desk' }, tools: ['https://peer.example/counter'] }],
    }
    const rt = new AgentRuntime({
      provider: providerThatCalls('counter', { request: 'stock?' }),
      actions: createActionRegistry(),
      consent: { request: async () => true },
      peers: sameOriginPeer,
      slyData: { trade_account: 'A-1', contact: '+44', bike_serial: 'WTU' },
      slyRules: rules,
    })
    const res = await rt.runNetwork({ network, frontMan: 'desk', request: 'go' })
    const note = res.events.find((e) => e.label === 'sly_data to peer')
    expect(note?.detail).toBe('sent: trade_account · withheld: contact, bike_serial')
  })

  it('does not contact a peer when the visitor declines', async () => {
    const network: NetworkDef = {
      tools: [{ name: 'desk', function: { description: 'desk' }, tools: ['https://peer.example/counter'] }],
    }
    let loaded = false
    const rt = new AgentRuntime({
      provider: providerThatCalls('counter', { request: 'stock?' }),
      actions: createActionRegistry(),
      consent: { request: async () => false },
      peers: {
        async load(url) {
          loaded = true
          return sameOriginPeer.load(url)
        },
      },
    })
    const res = await rt.runNetwork({ network, frontMan: 'desk', request: 'go' })
    expect(loaded).toBe(false)
    expect(res.events.some((e) => e.kind === 'consent' && e.status === 'denied')).toBe(true)
  })

  it('fails closed on a closed peer policy', async () => {
    const network: NetworkDef = {
      tools: [{ name: 'desk', function: { description: 'desk' }, tools: ['https://peer.example/counter'] }],
    }
    const rt = new AgentRuntime({
      provider: providerThatCalls('counter', { request: 'stock?' }),
      actions: createActionRegistry(),
      consent: { request: async () => true },
      peers: sameOriginPeer,
      peerPolicy: { mode: 'closed', allow: [], deny: [] },
    })
    const res = await rt.runNetwork({ network, frontMan: 'desk', request: 'go' })
    expect(res.events.some((e) => e.status === 'denied')).toBe(true)
  })
})

describe('the shop itself', () => {
  const now = new Date('2026-11-13T10:00:00Z')

  it('quotes labour plus the parts the job needs', () => {
    const q = quoteRepair('rear_derailleur', 'skips under load', now)
    expect(q).not.toBeNull()
    expect(q!.labour).toBe(40.5)
    expect(q!.total).toBe(86.5)
    expect(q!.lines.map((l) => l.name)).toContain('Derailleur hanger')
  })

  it('offers the next Thursday and the Friday after it', () => {
    const [thu, fri] = dropoffSlots(now)
    expect(thu.id).toBe('thu-1730')
    expect(fri.id).toBe('fri-0815')
    expect(thu.ready).toBe('Fri 17:00')
    expect(fri.ready).toBe('Mon 12:00')
  })

  it('maps the words a visitor uses onto part ids', () => {
    expect(partFrom('my rear mech skips')).toBe('rear_derailleur')
    expect(partFrom('the hanger is bent')).toBe('derailleur_hanger')
    expect(partFrom('brakes squeal')).toBe('brake_pads')
    expect(partFrom('bottom bracket creaks')).toBe('bottom_bracket')
  })
})

describe('default inference', () => {
  it('runs the whole network without a key or a network call', async () => {
    const actions = createActionRegistry()
    actions.register({
      name: 'get_shop_state',
      description: 'state',
      effect: 'read',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => ({ ok: true, data: { queue: [], parts: [], dropoffSlots: [] } }),
    })
    actions.register({
      name: 'highlight_part',
      description: 'highlight',
      effect: 'read',
      inputSchema: { type: 'object', properties: { part: { type: 'string' } }, required: ['part'], additionalProperties: false },
      execute: (a) => ({ ok: true, data: { lit: a.part } }),
    })
    const network: NetworkDef = {
      tools: [
        { name: 'front_desk', function: { description: 'front' }, tools: ['workshop_lead'] },
        { name: 'workshop_lead', function: { description: 'bench' }, tools: [] },
      ],
    }
    const rt = new AgentRuntime({ provider: createLocalPlanner(), actions, consent: { request: async () => true } })
    const res = await rt.runNetwork({ network, frontMan: 'front_desk', request: 'My rear derailleur skips under load.' })
    expect(res.error).toBeUndefined()
    expect(res.events.some((e) => e.kind === 'agent' && e.depth > 1)).toBe(true)
    expect(res.events.some((e) => e.label === 'website_highlight_part' && e.status === 'ok')).toBe(true)
  })
})
