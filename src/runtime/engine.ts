/**
 * The browser runtime: parse, validate, then run a published agent network.
 *
 * Deliberately small and explicit. The interesting requirements from the profile are
 * not the agent loop itself but its edges: bounded execution, consent before any
 * third-party contact, private context by exception, and reporting an outcome that is
 * true rather than merely "HTTP 200".
 */
import { validateArgs, validateNetwork } from './validate'
import type {
  AgentDef,
  Effect,
  LoadedPeer,
  ModelMessage,
  ModelProvider,
  ModelToolSpec,
  NetworkDef,
  PeerLoader,
  RunResult,
  SiteActionDef,
  TraceEvent,
  TraceKind,
  TraceStatus,
} from './types'

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'budget' | 'depth' | 'denied' | 'peer' | 'action',
  ) {
    super(message)
    this.name = 'RuntimeError'
  }
}

export interface Budgets {
  /** Model turns per agent invocation. */
  maxSteps: number
  /** Total agent invocations (including the front agent) for one visitor request. */
  maxCalls: number
  /** Composition depth: front agent = 1. */
  maxDepth: number
  /** Peer-network instantiations for one visitor request. */
  maxPeerCalls: number
  /** Wall-clock ceiling for one visitor request. */
  maxMs: number
}

export const DEFAULT_BUDGETS: Budgets = {
  maxSteps: 12,
  maxCalls: 12,
  maxDepth: 4,
  maxPeerCalls: 2,
  maxMs: 45_000,
}

export interface ConsentRequest {
  kind: 'peer' | 'action'
  origin: string
  purpose: string
  /** Field names only. Values are never shown in a consent decision. */
  fields: string[]
  action?: { name: string; effect: Effect; args: Record<string, unknown> }
}

export interface ConsentBroker {
  request(req: ConsentRequest): Promise<boolean>
}

export interface ActionRegistry {
  register(def: SiteActionDef): void
  get(name: string): SiteActionDef | undefined
  list(): SiteActionDef[]
}

export function createActionRegistry(): ActionRegistry {
  const map = new Map<string, SiteActionDef>()
  return {
    register(def) {
      if (map.has(def.name)) throw new RuntimeError(`Action "${def.name}" is already registered`, 'action')
      map.set(def.name, def)
    },
    get: (name) => map.get(name),
    list: () => [...map.values()],
  }
}

/** A permission for one named destination network, by identity rather than by origin. */
export interface SlyRule {
  destination: string
  fields: string[]
}

export interface RuntimeOptions {
  provider: ModelProvider
  actions: ActionRegistry
  consent: ConsentBroker
  peers?: PeerLoader
  /** Private context carried by the page. Never sent unless a rule names the field. */
  slyData?: Record<string, unknown>
  slyRules?: SlyRule[]
  /** The caller site's peer policy, read from its manifest. */
  peerPolicy?: { mode: 'open' | 'closed'; allow: string[]; deny: string[] }
  /** Origin of the page running the network; used on action confirmations. */
  origin?: string
  budgets?: Partial<Budgets>
  onEvent?: (event: TraceEvent) => void
  now?: () => Date
  /** Injected so tests and the conformance panel can record third-party contact. */
  onOrigin?: (origin: string, purpose: string) => void
}

interface RunState {
  startedAt: number
  events: TraceEvent[]
  seq: number
  calls: number
  peerCalls: number
  actionCalls: number
  origins: Set<string>
  /** Writes whose outcome is unknown must not be retried by the runtime. */
  poisoned: Set<string>
  network: NetworkDef
  depth: number
}

const ACTION_PREFIX = 'website_'

export class AgentRuntime {
  private readonly budgets: Budgets

  constructor(private readonly opts: RuntimeOptions) {
    this.budgets = { ...DEFAULT_BUDGETS, ...(opts.budgets ?? {}) }
  }

  async runNetwork(input: {
    network: NetworkDef
    frontMan: string
    request: string
  }): Promise<RunResult> {
    const check = validateNetwork(input.network, input.frontMan)
    if (!check.ok) throw new RuntimeError(`Invalid network:\n· ${check.errors.join('\n· ')}`, 'invalid')

    const state: RunState = {
      startedAt: Date.now(),
      events: [],
      seq: 0,
      calls: 0,
      peerCalls: 0,
      actionCalls: 0,
      origins: new Set(),
      poisoned: new Set(),
      network: input.network,
      depth: 1,
    }

    this.emit(state, { kind: 'run', label: `run ${input.frontMan}`, detail: this.opts.provider.label, status: 'ok', depth: 0 })

    try {
      const text = await this.runAgent(state, input.frontMan, input.request, 1)
      return {
        text,
        events: state.events,
        usage: {
          agentCalls: state.calls,
          actionCalls: state.actionCalls,
          peerCalls: state.peerCalls,
          ms: Date.now() - state.startedAt,
        },
        origins: [...state.origins],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit(state, { kind: 'error', label: 'run stopped', detail: message, status: 'error', depth: 0 })
      return {
        text: '',
        events: state.events,
        usage: {
          agentCalls: state.calls,
          actionCalls: state.actionCalls,
          peerCalls: state.peerCalls,
          ms: Date.now() - state.startedAt,
        },
        origins: [...state.origins],
        error: message,
      }
    }
  }

  private async runAgent(state: RunState, agentName: string, request: string, depth: number): Promise<string> {
    if (depth > this.budgets.maxDepth) {
      throw new RuntimeError(
        `Composition depth ${depth} exceeds the limit of ${this.budgets.maxDepth}. Stopped before calling "${agentName}".`,
        'depth',
      )
    }
    const agent = this.findAgent(state.network, agentName)
    if (!agent) throw new RuntimeError(`Agent "${agentName}" is not in the network`, 'invalid')

    state.calls += 1
    if (state.calls > this.budgets.maxCalls) {
      throw new RuntimeError(`Agent call budget (${this.budgets.maxCalls}) is spent. Stopped.`, 'budget')
    }

    this.emit(state, {
      kind: 'agent',
      agent: agent.name,
      label: agent.name,
      status: 'ok',
      depth,
    })

    const tools = this.buildTools(state.network, agent)
    const messages: ModelMessage[] = [{ role: 'user', content: request }]
    // The agent's own name leads the prompt: it is part of who is speaking.
    const system = `${agent.name}\n\n${agent.instructions?.trim() || agent.function.description}`

    for (let step = 0; step < this.budgets.maxSteps; step += 1) {
      this.checkClock(state)
      const turn = await this.opts.provider.chat({
        system,
        messages,
        tools,
      })
      if (!turn.toolCalls || turn.toolCalls.length === 0) {
        return (turn.text ?? '').trim()
      }
      messages.push({
        role: 'assistant',
        content: turn.text ?? '',
        toolCalls: turn.toolCalls,
      })
      for (const call of turn.toolCalls) {
        const spec = tools.find((t) => t.name === call.name)
        const result = spec
          ? await this.dispatch(state, spec, call.args ?? {}, depth)
          : { text: `No tool named "${call.name}" in this agent.`, status: 'refused' as TraceStatus }
        messages.push({ role: 'tool', name: call.name, content: result.text, toolCallId: call.id })
        if (result.fatal) throw new RuntimeError(result.text, 'budget')
      }
    }
    throw new RuntimeError(
      `Agent "${agent.name}" used its ${this.budgets.maxSteps} model turns without answering. Stopped.`,
      'budget',
    )
  }

  private buildTools(network: NetworkDef, agent: AgentDef): ModelToolSpec[] {
    const specs: ModelToolSpec[] = []
    const used = new Set<string>()
    const names = new Set((network.tools ?? []).map((a) => a.name))

    for (const ref of agent.tools ?? []) {
      if (typeof ref === 'string' && names.has(ref)) {
        const sub = this.findAgent(network, ref)
        if (!sub) continue
        specs.push({
          name: ref,
          description: sub.function.description,
          parameters: sub.function.parameters ?? { type: 'object', properties: { request: { type: 'string' } }, required: ['request'] },
          route: { kind: 'agent', agent: ref },
        })
        used.add(ref)
      } else {
        const url = typeof ref === 'string' ? ref : ref?.url
        if (!url) continue
        const label = peerName(url)
        const name = used.has(label) ? `${label}_${specs.length}` : label
        specs.push({
          name,
          description: `Ask the published agent network at ${new URL(url).origin} (${label}). Its agents run in this browser, with this session's model.`,
          parameters: { type: 'object', properties: { request: { type: 'string', description: 'What to ask, in plain language.' } }, required: ['request'] },
          route: { kind: 'peer', url },
        })
        used.add(name)
      }
    }

    for (const action of this.opts.actions.list()) {
      const name = ACTION_PREFIX + action.name
      if (used.has(name)) continue
      specs.push({
        name,
        description: action.description,
        parameters: action.inputSchema,
        route: { kind: 'action', action: action.name, effect: action.effect },
      })
      used.add(name)
    }

    return specs
  }

  private async dispatch(
    state: RunState,
    spec: ModelToolSpec,
    args: Record<string, unknown>,
    depth: number,
  ): Promise<{ text: string; status: TraceStatus; fatal?: boolean }> {
    if (spec.route.kind === 'agent') {
      const text = await this.runAgent(state, spec.route.agent, String(args.request ?? ''), depth + 1)
      return { text: text || '(that agent returned no text)', status: 'ok' }
    }
    if (spec.route.kind === 'peer') return this.callPeer(state, spec.route.url, args, depth)
    if (spec.route.kind === 'action') return this.callAction(state, spec.route.action, args, depth)
    return { text: spec.route.why, status: 'refused' }
  }

  private async callPeer(
    state: RunState,
    url: string,
    args: Record<string, unknown>,
    depth: number,
  ): Promise<{ text: string; status: TraceStatus }> {
    const origin = new URL(url).origin
    if (state.peerCalls >= this.budgets.maxPeerCalls) {
      return { text: `This run already contacted ${this.budgets.maxPeerCalls} peer networks. Stopped.`, status: 'refused' }
    }
    if (!this.opts.peers) return { text: 'No peer loader is configured.', status: 'refused' }

    const allowed = this.peerAllowed(origin)
    if (!allowed.ok) {
      this.emit(state, { kind: 'error', label: 'peer blocked', detail: allowed.error, status: 'denied', depth })
      return { text: allowed.error, status: 'denied' }
    }

    const decision = await this.opts.consent.request({
      kind: 'peer',
      origin,
      purpose: `Ask ${peerLabelFromUrl(url)} for facts. Its agents run in this tab with this session's model.`,
      fields: [],
    })
    this.emit(state, {
      kind: 'consent',
      label: decision ? 'allowed' : 'declined',
      detail: origin,
      status: decision ? 'ok' : 'denied',
      depth,
    })
    if (!decision) return { text: 'The visitor declined contact with that site. Nothing was fetched.', status: 'denied' }

    state.peerCalls += 1
    this.opts.onOrigin?.(origin, 'peer network')
    state.origins.add(origin)
    this.emit(state, { kind: 'peer', label: `load ${peerName(url)}`, detail: origin, status: 'ok', depth })

    let peer: LoadedPeer
    try {
      peer = await this.opts.peers.load(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit(state, { kind: 'error', label: 'peer failed', detail: message, status: 'error', depth })
      return { text: `Could not load that peer network: ${message}`, status: 'error' }
    }

    // Private context is deny-by-default; only fields named for this destination pass.
    const passed = this.filterSly(peer.networkName)
    this.emit(state, {
      kind: 'note',
      label: 'sly_data to peer',
      detail: `sent: ${Object.keys(passed.sent).join(', ') || '(none)'} · withheld: ${passed.withheld.join(', ') || '(none)'}`,
      status: 'ok',
      depth,
    })

    const parent = state.network
    const parentDepth = state.depth
    state.network = peer.network
    state.depth = depth + 1
    try {
      const text = await this.runAgent(state, peer.frontMan, String(args.request ?? ''), depth + 1)
      return { text: text || '(that network returned no text)', status: 'ok' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { text: `That peer network stopped: ${message}`, status: 'error' }
    } finally {
      state.network = parent
      state.depth = parentDepth
    }
  }

  private async callAction(
    state: RunState,
    actionName: string,
    args: Record<string, unknown>,
    depth: number,
  ): Promise<{ text: string; status: TraceStatus }> {
    const action = this.opts.actions.get(actionName)
    if (!action) return { text: `No site action named "${actionName}".`, status: 'refused' }

    const check = validateArgs(action.inputSchema, args)
    if (!check.ok) {
      this.emit(state, {
        kind: 'error',
        agent: undefined,
        label: ACTION_PREFIX + actionName,
        detail: `arguments rejected: ${check.errors.join('; ')}`,
        status: 'refused',
        depth,
        args,
      })
      return {
        text: `The runtime rejected these arguments before running anything: ${check.errors.join('; ')}. Fix the arguments and try again.`,
        status: 'refused',
      }
    }

    const key = actionName + JSON.stringify(args)
    if (action.effect === 'write' && state.poisoned.has(key)) {
      this.emit(state, {
        kind: 'error',
        label: ACTION_PREFIX + actionName,
        detail: 'not repeated: this write already had an unknown outcome',
        status: 'refused',
        depth,
        args,
      })
      return {
        text: 'This write already had an unknown outcome. The runtime will not repeat it; ask the visitor to check the page.',
        status: 'refused',
      }
    }

    if (action.effect === 'write') {
      const decision = await this.opts.consent.request({
        kind: 'action',
        origin: this.opts.origin ?? 'this site',
        purpose: `Run "${actionName}" on this page.`,
        fields: [],
        action: { name: actionName, effect: action.effect, args },
      })
      this.emit(state, {
        kind: 'confirm',
        label: `confirm ${ACTION_PREFIX + actionName}`,
        detail: decision ? 'visitor confirmed' : 'visitor cancelled',
        status: decision ? 'ok' : 'denied',
        depth,
        args,
      })
      if (!decision) {
        return { text: 'The visitor cancelled. Nothing changed.', status: 'denied' }
      }
    }

    const started = Date.now()
    state.actionCalls += 1
    try {
      const result = await action.execute(args, {
        // A site action runs on the page that owns the data, so it sees the page's own
        // private context. The model still does not: it only ever sees the result.
        sly: this.opts.slyData ?? {},
        now: (this.opts.now ?? (() => new Date()))(),
      })
      const ms = Date.now() - started
      if (!result.ok) {
        this.emit(state, {
          kind: 'tool',
          label: ACTION_PREFIX + actionName,
          detail: result.reason ?? 'refused',
          status: 'refused',
          depth,
          ms,
          args,
        })
        return {
          text: `The site refused and nothing changed. Reason: ${result.reason ?? 'not stated'}. Tell the visitor, and ask for what is missing.`,
          status: 'refused',
        }
      }
      this.emit(state, {
        kind: 'tool',
        label: ACTION_PREFIX + actionName,
        detail: summarise(actionName, result.data),
        status: 'ok',
        depth,
        ms,
        args,
        data: result.data,
      })
      return { text: JSON.stringify({ status: 'succeeded', result: result.data }), status: 'ok' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (action.effect === 'write') state.poisoned.add(key)
      this.emit(state, {
        kind: 'error',
        label: ACTION_PREFIX + actionName,
        detail: `unknown outcome: ${message}`,
        status: 'unknown',
        depth,
        args,
      })
      return {
        text: `Unknown outcome: "${actionName}" failed after it may have started (${message}). The page state is not trustworthy; tell the visitor to check the page. Do not retry.`,
        status: 'unknown',
      }
    }
  }

  private peerAllowed(origin: string): { ok: true } | { ok: false; error: string } {
    const p = this.opts.peerPolicy
    if (!p) return { ok: true }
    // Publishers list peer URLs; the check is on origins, so compare like with like.
    const origins = (list: string[]) =>
      new Set(
        list.map((entry) => {
          try {
            return new URL(entry).origin
          } catch {
            return entry
          }
        }),
      )
    if (origins(p.deny).has(origin)) {
      return { ok: false, error: `This site's peer policy denies ${origin}. Nothing was contacted.` }
    }
    if (p.mode === 'closed' && !origins(p.allow).has(origin)) {
      return {
        ok: false,
        error: `This site's peer policy is closed. ${origin} is not on the allow list, so the runtime stopped before contacting it.`,
      }
    }
    return { ok: true }
  }

  private filterSly(destination: string): { sent: Record<string, unknown>; withheld: string[] } {
    const rules = this.opts.slyRules ?? []
    const allowed = new Set(rules.filter((r) => r.destination === destination).flatMap((r) => r.fields))
    const current = this.opts.slyData ?? {}
    const sent: Record<string, unknown> = {}
    const withheld: string[] = []
    for (const key of Object.keys(current)) {
      if (allowed.has(key)) sent[key] = current[key]
      else withheld.push(key)
    }
    return { sent, withheld }
  }

  private checkClock(state: RunState): void {
    if (Date.now() - state.startedAt > this.budgets.maxMs) {
      throw new RuntimeError(`This request passed its ${this.budgets.maxMs / 1000}s ceiling. Stopped.`, 'budget')
    }
  }

  private findAgent(network: NetworkDef, name: string): AgentDef | undefined {
    return (network.tools ?? []).find((a) => a.name === name)
  }

  private emit(
    state: RunState,
    event: Omit<TraceEvent, 'seq' | 'at'> & { kind: TraceKind },
  ): void {
    const full: TraceEvent = { ...event, seq: state.seq++, at: Date.now() - state.startedAt }
    state.events.push(full)
    this.opts.onEvent?.(full)
  }
}

function peerName(url: string): string {
  const clean = url.replace(/\/+$/, '')
  const last = clean.split('/').pop() ?? 'peer'
  return last || 'peer'
}

function peerLabelFromUrl(url: string): string {
  return peerName(url).replace(/[_-]/g, ' ')
}

/** A short line for the trace: enough to recognise the result, short enough to scan. */
function summarise(action: string, data: unknown): string {
  if (data === undefined || data === null) return 'ok'
  const d = data as Record<string, unknown>
  switch (action) {
    case 'get_shop_state':
      return `queue ${(d.queue as unknown[])?.length ?? 0} · parts ${(d.parts as unknown[])?.length ?? 0} · ${(d.dropoffSlots as unknown[])?.length ?? 0} slots`
    case 'highlight_part':
      return String(d.lit ?? '')
    case 'quote_repair':
      return `£${Number(d.total).toFixed(2).replace(/\.00$/, '')} · ready ${String(d.readyBy ?? '')}`
    case 'check_dropoff_slots':
      return `${(d.slots as unknown[])?.length ?? 0} slots`
    case 'book_dropoff':
    case 'order_part':
      return `receipt ${String(d.receipt_id ?? '')} · ${String(d.outcome ?? '')}`
    case 'lookup_ticket':
      return `${String(d.ticket ?? '')} · ready ${String(d.ready ?? '')}`
    default: {
      const text = JSON.stringify(data)
      return text.length > 64 ? text.slice(0, 61) + '…' : text
    }
  }
}
