/**
 * Shared shapes for the open agentic web runtime.
 *
 * These follow the published profile: an agent-manifest.json indexes the networks a
 * site publishes, each network is a resolved, data-only graph in the Neuro SAN data
 * model, and a browser runtime executes it.
 */

export type Effect = 'read' | 'write'

/** A small JSON Schema subset: enough for tool inputs, and strict enough to reject. */
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: Array<string | number>
  format?: string
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

export type AgentToolRef = string | { url: string; tools?: string[] }

/** One agent in a published network. `tools` may name sibling agents or peer URLs. */
export interface AgentDef {
  name: string
  function: { description: string; parameters?: JsonSchema }
  instructions?: string
  tools?: AgentToolRef[]
  /** Present on some publishers' networks; ignored by this runtime. */
  model_name?: string
}

/** A resolved, data-only agent network (JSON serialisation of the HOCON data model). */
export interface NetworkDef {
  metadata?: { description?: string; sample_queries?: string[] }
  llm_config?: { model_name?: string }
  max_steps?: number
  tools?: AgentDef[]
}

export interface ManifestNetworkEntry {
  name: string
  front_man: string
  hocon: string
  description?: string
  tags?: string[]
  sample_queries?: string[]
}

export interface AgentManifest {
  brand?: string
  networks?: ManifestNetworkEntry[]
  llm_router?: { base_url?: string; mock?: boolean; byok_router?: string }
  allowed_peers?: string[]
  peer_policy?: { mode?: 'open' | 'closed'; deny_origins?: string[]; note?: string }
  actions?: { version?: number; module?: string; bridge?: string; agentTools?: string[] }
  deployment?: Record<string, unknown>
  theme?: { primary?: string }
}

/* ------------------------------------------------------------------ actions */

export interface ActionContext {
  /** Fields the network is allowed to pass to this action's destination. */
  sly: Record<string, unknown>
  now: Date
}

export interface ActionResult {
  ok: boolean
  reason?: string
  data?: unknown
}

export interface SiteActionDef {
  name: string
  description: string
  effect: Effect
  inputSchema: JsonSchema
  execute: (args: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult> | ActionResult
}

/* ------------------------------------------------------------------- trace */

export type TraceKind = 'run' | 'agent' | 'tool' | 'peer' | 'consent' | 'confirm' | 'error' | 'note'
export type TraceStatus = 'ok' | 'refused' | 'unknown' | 'denied' | 'error' | 'pending'

export interface TraceEvent {
  seq: number
  at: number
  kind: TraceKind
  agent?: string
  label: string
  detail?: string
  status: TraceStatus
  depth: number
  ms?: number
  args?: Record<string, unknown>
  data?: unknown
}

/* --------------------------------------------------------------------- model */

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool result messages carry the id of the call they answer. */
  name?: string
  toolCallId?: string
  /** Assistant turns that asked for tools carry what they asked for. */
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>
}

export interface ModelToolSpec {
  name: string
  description: string
  parameters: JsonSchema
  /** How the runtime will route a call to this tool. */
  route:
    | { kind: 'agent'; agent: string }
    | { kind: 'peer'; url: string }
    | { kind: 'action'; action: string; effect: Effect }
    | { kind: 'unsupported'; why: string }
}

export interface ModelTurn {
  text?: string
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>
}

export interface ModelProvider {
  id: string
  label: string
  /** True when the provider talks to the network. The UI shows this in the session panel. */
  networked: boolean
  chat(input: {
    system: string
    messages: ModelMessage[]
    tools: ModelToolSpec[]
    signal?: AbortSignal
  }): Promise<ModelTurn>
}

/* -------------------------------------------------------------------- peers */

export interface LoadedPeer {
  base: string
  origin: string
  networkName: string
  frontMan: string
  manifest: AgentManifest
  network: NetworkDef
}

export interface PeerLoader {
  /** Resolve a peer-network URL to a validated network that runs in this browser. */
  load(url: string): Promise<LoadedPeer>
}

/* ------------------------------------------------------------------ results */

export interface RunResult {
  text: string
  events: TraceEvent[]
  usage: { agentCalls: number; actionCalls: number; peerCalls: number; ms: number }
  /** Every origin the runtime contacted while running this request. */
  origins: string[]
  error?: string
}
