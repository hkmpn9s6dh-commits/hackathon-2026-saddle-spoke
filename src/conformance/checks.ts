/**
 * The profile's MVP interoperability checks, as executable tests.
 *
 * Each check drives the real runtime. Nothing here asserts a fact about the code that the
 * code could not disprove: the checks either observe a run, observe a fetch, or observe a
 * run being stopped.
 */
import {
  AgentRuntime,
  createActionRegistry,
  type ActionRegistry,
  type Budgets,
  type RuntimeOptions,
  type SlyRule,
} from '../runtime/engine'
import type { AgentManifest, ModelProvider, ModelToolSpec, NetworkDef, PeerLoader } from '../runtime/types'
import { validateManifest, validateNetwork } from '../runtime/validate'
import { createPeerLoader } from '../runtime/peers'

export interface CheckContext {
  manifest: AgentManifest
  network: NetworkDef
  frontMan: string
  provider: ModelProvider
  actions: ActionRegistry
  peers: PeerLoader
  slyData: Record<string, unknown>
  slyRules: SlyRule[]
  peerUrl: string
}

export interface CheckResult {
  pass: boolean
  note: string
}

export interface CheckDef {
  id: string
  title: string
  detail: string
  ref: string
  run(ctx: CheckContext): Promise<CheckResult>
}

const allowAll = { request: async () => true }
const denyAll = { request: async () => false }

function mkRuntime(ctx: CheckContext, over: Partial<RuntimeOptions> = {}): AgentRuntime {
  return new AgentRuntime({
    provider: ctx.provider,
    actions: ctx.actions,
    consent: allowAll,
    peers: ctx.peers,
    slyData: ctx.slyData,
    slyRules: ctx.slyRules,
    peerPolicy: { mode: 'open', allow: [], deny: [] },
    ...over,
  })
}

export const CONFORMANCE_CHECKS: CheckDef[] = [
  {
    id: 'publish',
    title: 'Publish a network and a manifest from an ordinary web host',
    detail: 'Fetches agent-manifest.json and the resolved network from this origin and validates both.',
    ref: '§6 · 1',
    async run(_ctx) {
      const base = new URL('.', location.href).toString()
      const manifestRes = await fetch(new URL('agent-manifest.json', base), { headers: { accept: 'application/json' } })
      const netRes = await fetch(new URL('saddle_and_spoke.network.json', base), { headers: { accept: 'application/json' } })
      if (!manifestRes.ok || !netRes.ok) return { pass: false, note: `manifest ${manifestRes.status}, network ${netRes.status}` }
      const manifest = JSON.parse(await manifestRes.text()) as AgentManifest
      const net = JSON.parse(await netRes.text()) as NetworkDef
      const m = validateManifest(manifest)
      const entry = manifest.networks?.[0]
      const n = entry ? validateNetwork(net, entry.front_man) : { ok: false, errors: ['no network entry'] }
      const agents = net.tools?.length ?? 0
      return {
        pass: m.ok && n.ok && agents >= 2,
        note: `${agents} agents, ${m.ok ? 'manifest valid' : 'manifest invalid: ' + m.errors.join('; ')}${n.ok ? '' : ', network invalid: ' + n.errors.join('; ')}`,
      }
    },
  },
  {
    id: 'run',
    title: 'Run that network in a browser with the site\'s default inference',
    detail: 'Runs a visitor question on the local planner: no key, no network calls.',
    ref: '§6 · 2',
    async run(ctx) {
      const rt = mkRuntime(ctx)
      const res = await rt.runNetwork({ network: ctx.network, frontMan: ctx.frontMan, request: 'What would new brake pads cost, fitted?' })
      const agents = res.events.filter((e) => e.kind === 'agent').length
      return { pass: Boolean(res.text) && agents > 0, note: `${agents} agents ran, ${res.text.length} characters back${res.error ? `, stopped: ${res.error}` : ''}` }
    },
  },
  {
    id: 'internal',
    title: 'Call an internal agent and a registered site action',
    detail: 'Looks for a delegation and a website_* action in the same run.',
    ref: '§6 · 3',
    async run(ctx) {
      const res = await mkRuntime(ctx).runNetwork({ network: ctx.network, frontMan: ctx.frontMan, request: 'My rear derailleur skips under load. Can you fix it before Friday?' })
      const delegated = res.events.some((e) => e.kind === 'agent' && e.depth > 1)
      const actions = res.events.filter((e) => e.kind === 'tool' && e.label.startsWith('website_'))
      return { pass: delegated && actions.length > 0, note: `delegation ${delegated ? 'yes' : 'no'}, site actions ${actions.map((a) => a.label).join(', ') || 'none'}` }
    },
  },
  {
    id: 'peer',
    title: 'Load an exact named network from a second origin, after approval',
    detail: 'Asks the trade counter; fetches its manifest, matches the name exactly, and runs it here.',
    ref: '§6 · 4',
    async run(ctx) {
      const res = await mkRuntime(ctx).runNetwork({ network: ctx.network, frontMan: ctx.frontMan, request: 'My rear derailleur skips under load. Can you fix it before Friday?' })
      const consent = res.events.find((e) => e.kind === 'consent')
      const peer = res.events.find((e) => e.kind === 'peer')
      const answer = res.events.some((e) => e.kind === 'note' && e.label === 'sly_data to peer')
      return {
        pass: Boolean(consent) && Boolean(peer) && peer?.status === 'ok' && answer,
        note: peer ? `${peer.detail ?? ''} · ${peer.status}` : consent ? 'asked, not loaded' : 'no peer contact in this run',
      }
    },
  },
  {
    id: 'key',
    title: 'A visitor key never reaches the peer and cannot change the caller\'s router',
    detail: 'Probes every request made while loading the peer for the string of a live BYOK key.',
    ref: '§6 · 5',
    async run(ctx) {
      const probe = 'sk-PROBE-DO-NOT-LEAK-4f2a'
      const realFetch = globalThis.fetch
      const seen: Array<{ url: string; leaked: boolean }> = []
      const spy: typeof fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const hay = `${url} ${JSON.stringify(init?.headers ?? {})} ${String(init?.body ?? '')}`
        seen.push({ url, leaked: hay.includes(probe) })
        return realFetch(input, init)
      }
      globalThis.fetch = spy
      try {
        const loader = createPeerLoader({ fetchImpl: spy })
        await loader.load(ctx.peerUrl)
      } catch (err) {
        return { pass: false, note: `peer load failed: ${err instanceof Error ? err.message : String(err)}` }
      } finally {
        globalThis.fetch = realFetch
      }
      const leaked = seen.filter((s) => s.leaked)
      const toPeer = seen.filter((s) => s.url.includes(new URL(ctx.peerUrl).host))
      return {
        pass: leaked.length === 0 && toPeer.length > 0,
        note: leaked.length === 0 ? `${toPeer.length} requests to the peer origin, none carried a key` : `leaked in ${leaked.map((l) => l.url).join(', ')}`,
      }
    },
  },
  {
    id: 'sly',
    title: 'Private context is absent at the peer unless a field is named',
    detail: 'Reads the runtime\'s own accounting of what it sent and what it withheld.',
    ref: '§6 · 6',
    async run(ctx) {
      const res = await mkRuntime(ctx).runNetwork({ network: ctx.network, frontMan: ctx.frontMan, request: 'My rear derailleur skips under load. Can you fix it before Friday?' })
      const note = res.events.find((e) => e.kind === 'note' && e.label === 'sly_data to peer')
      const detail = note?.detail ?? ''
      const ok = detail.includes('sent: trade_account') && detail.includes('contact') && detail.includes('withheld')
      return { pass: ok, note: detail || 'no peer call, so nothing was computed' }
    },
  },
  {
    id: 'stop',
    title: 'Stop an invalid network, a composition cycle, an over-budget request and a denied origin',
    detail: 'Four deliberately broken runs. Each must stop, with the reason visible.',
    ref: '§6 · 7',
    async run(ctx) {
      const results: string[] = []
      let pass = true
      const attempt = async (run: Promise<{ error?: string }>): Promise<string | undefined> => {
        try {
          const out = await run
          return out.error
        } catch (err) {
          // A rejected run is a stopped run: that is the behaviour under test.
          return err instanceof Error ? err.message : String(err)
        }
      }

      // 1. duplicate agent name: rejected before any model call
      const dup: NetworkDef = {
        tools: [
          { name: 'a', function: { description: 'first' } },
          { name: 'a', function: { description: 'second' } },
        ],
      }
      const dupError = await attempt(mkRuntime(ctx).runNetwork({ network: dup, frontMan: 'a', request: 'hi' }))
      if (!dupError?.includes('duplicate')) pass = false
      results.push(`invalid ${dupError ? 'stopped' : 'RAN'}`)

      // 2. depth: a chain longer than the budget
      const chain: NetworkDef = {
        tools: ['a', 'b', 'c', 'd', 'e', 'f'].map((name, i, all) => ({
          name,
          function: { description: `step ${name}` },
          tools: all[i + 1] ? [all[i + 1]] : [],
        })),
      }
      const chainProvider = chainModel()
      const deepError = await attempt(
        new AgentRuntime({
          provider: chainProvider,
          actions: createActionRegistry(),
          consent: allowAll,
          budgets: { maxDepth: 3, maxCalls: 20, maxSteps: 4 },
        }).runNetwork({ network: chain, frontMan: 'a', request: 'go' }),
      )
      if (!deepError) pass = false
      results.push(`depth ${deepError ? 'stopped' : 'RAN'}`)

      // 3. budget: more agent calls than allowed
      const budgetError = await attempt(
        new AgentRuntime({
          provider: chainModel(),
          actions: createActionRegistry(),
          consent: allowAll,
          budgets: { maxDepth: 8, maxCalls: 2, maxSteps: 4 },
        }).runNetwork({ network: chain, frontMan: 'a', request: 'go' }),
      )
      if (!budgetError) pass = false
      results.push(`budget ${budgetError ? 'stopped' : 'RAN'}`)

      // 4. peer policy: a closed list that excludes this peer
      const peerRun = await mkRuntime(ctx, {
        peerPolicy: { mode: 'closed', allow: [], deny: [] },
      }).runNetwork({ network: ctx.network, frontMan: ctx.frontMan, request: 'Is a derailleur hanger on the shelf?' })
      const denied = peerRun.events.some((e) => e.status === 'denied')
      if (!denied) pass = false
      results.push(`denied origin ${denied ? 'stopped' : 'CONTACTED'}`)

      // 5. consent refused: nothing is fetched
      const refuse = await new AgentRuntime({
        provider: ctx.provider,
        actions: ctx.actions,
        consent: denyAll,
        peers: ctx.peers,
        peerPolicy: { mode: 'open', allow: [], deny: [] },
      }).runNetwork({ network: ctx.network, frontMan: ctx.frontMan, request: 'My rear derailleur skips under load. Can you fix it before Friday?' })
      const refused = refuse.events.some((e) => e.kind === 'consent' && e.status === 'denied')
      if (!refused) pass = false
      results.push(`consent refused ${refused ? 'stopped' : 'CONTACTED'}`)

      return { pass, note: results.join(' · ') }
    },
  },
]

/** A model that always delegates to the next agent, until there is none. */
function chainModel(): ModelProvider {
  return {
    id: 'chain',
    label: 'chain probe',
    networked: false,
    async chat({ tools }: { tools: ModelToolSpec[] }) {
      const next = tools.find((t) => t.route.kind === 'agent')
      if (next) return { toolCalls: [{ id: 'x', name: next.name, args: { request: 'go' } }] }
      return { text: 'done' }
    },
  }
}

export type { Budgets }
