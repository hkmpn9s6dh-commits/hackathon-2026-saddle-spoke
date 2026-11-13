/**
 * The page: shop wall on the left, the bench on the right.
 *
 * Everything the page shows about money, stock or timing comes from the site actions.
 * The panel shows what the runtime did, so a visitor can see the machine working.
 */
import './styles.css'
import { AgentRuntime, createActionRegistry, type RuntimeOptions, type SlyRule } from './runtime/engine'
import { createLocalPlanner, partFrom } from './runtime/planner'
import { createByokProvider, loadProfile, saveProfile, clearProfile, type ByokProfile } from './runtime/byok'
import { createPeerLoader } from './runtime/peers'
import { resolveNetworkEntry, validateManifest, validateNetwork } from './runtime/validate'
import type { AgentManifest, ModelProvider, NetworkDef, TraceEvent } from './runtime/types'
import { PARTS, dropoffSlots, quoteRepair } from './shop/data'
import { ShopStore } from './shop/store'
import { createShopActions, type ShopBridge } from './shop/actions'
import { PEER_URL, IS_LOCAL } from './config'
import { CONFORMANCE_CHECKS, type CheckResult } from './conformance/checks'

/* ------------------------------------------------------------------ boot */

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`missing element ${sel}`)
  return el
}

const SLY_DATA: Record<string, unknown> = {
  contact: '+44 7700 900412',
  bike_serial: 'WTU-8842',
  trade_account: 'SS-TRADE-118',
}

const SLY_RULES: SlyRule[] = [{ destination: 'bellwether_parts', fields: ['trade_account'] }]

const store = new ShopStore()
const actions = createActionRegistry()

let manifest: AgentManifest = { networks: [] }
let network: NetworkDef = { tools: [] }
let frontMan = 'front_desk'
let provider: ModelProvider = createLocalPlanner()
let busy = false

const session = {
  origins: new Set<string>(),
  contacted: [] as Array<{ origin: string; purpose: string; at: string }>,
}

const peers = createPeerLoader({
  onOrigin: (origin, purpose) => noteOrigin(origin, purpose),
})

/* --------------------------------------------------------------- bridge */

const bridge: ShopBridge = {
  highlight: (partId) => setSpotlight(partId),
  jobCard: (quote) => {
    if (!quote) return
    const card = $('#jobcard')
    $('#jobcardNo').textContent = 'DRAFT'
    $('#jobFor').textContent = quote.partName
    $('#jobWork').textContent =
      quote.lines.length > 2 ? `${quote.lines[0].name} + ${quote.lines.length - 1} parts` : quote.lines.map((l) => l.name).join(', ')
    $('#jobPrice').textContent = money(quote.total)
    $('#jobReady').textContent = quote.readyBy
    card.classList.remove('is-filled')
    void card.offsetWidth
    card.classList.add('is-filled')
  },
  receipt: (r) => {
    $('#jobcardNo').textContent = r.id
    $('#jobReady').textContent = 'booked'
    const card = el('div', 'receipt')
    card.append(el('div', 'rid', r.id))
    card.append(el('div', 'outcome', 'outcome: confirmed'))
    card.append(el('div', 'summary', r.summary))
    $('#transcript').append(card)
    scrollDown()
  },
}

for (const action of createShopActions({ store, bridge })) actions.register(action)

/* ------------------------------------------------------------- spotlight */

function setSpotlight(partId: string | null): void {
  const svg = $('#bike') as unknown as SVGSVGElement
  const spot = $('#spot')
  const callout = $('#callout')
  for (const g of Array.from(svg.querySelectorAll<SVGGElement>('.part'))) {
    g.classList.toggle('is-lit', g.dataset.part === partId)
  }
  if (!partId) {
    svg.classList.remove('has-focus')
    spot.hidden = true
    callout.hidden = true
    return
  }
  const group = svg.querySelector<SVGGElement>(`.part[data-part="${partId}"]`)
  const part = PARTS.find((p) => p.id === partId)
  if (!group || !part) return
  const box = group.getBoundingClientRect()
  const wrapBox = $('#bikeWrap').getBoundingClientRect()
  // Screen coordinates keep the ring exact whatever the viewBox crops to.
  const x = box.left + box.width / 2 - wrapBox.left
  const y = box.top + box.height / 2 - wrapBox.top
  spot.style.transform = `translate(${x}px, ${y}px)`
  spot.hidden = false
  callout.style.transform = `translate(${x + 86}px, ${y - 26}px) translateY(-50%)`
  ;($('#calloutName') as HTMLElement).textContent = part.name
  ;($('#calloutSku') as HTMLElement).textContent = part.sku
  callout.hidden = false
  svg.classList.add('has-focus')
}

function replaceSpotlight(): void {
  const lit = document.querySelector('.part.is-lit') as SVGGElement | null
  if (lit?.dataset.part) setSpotlight(lit.dataset.part)
}

window.addEventListener('resize', replaceSpotlight)
// The wall reflows when the job card fills in; keep the ring on the part.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(replaceSpotlight).observe($('#bikeWrap'))
}

/* ----------------------------------------------------------------- chat */

const transcript = $('#transcript')
const input = $('#say') as unknown as HTMLInputElement
const send = $('#send') as HTMLButtonElement
const lamp = $('#lamp')

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function money(n: number): string {
  return '£' + n.toFixed(2).replace(/\.00$/, '')
}

function scrollDown(): void {
  // Two frames: the node is in the DOM now, but fonts and wrapping settle after layout.
  requestAnimationFrame(() => {
    transcript.scrollTop = transcript.scrollHeight
    requestAnimationFrame(() => {
      transcript.scrollTop = transcript.scrollHeight
    })
  })
}

function addMessage(role: 'user' | 'agent', text: string, label?: string): void {
  const wrap = el('div', `msg ${role}`)
  wrap.append(el('div', 'msg-label', label ?? (role === 'user' ? 'You' : 'Front desk')))
  wrap.append(el('div', 'msg-text', text))
  transcript.append(wrap)
  scrollDown()
}

function traceHost(): HTMLElement {
  let host = transcript.querySelector<HTMLElement>('.trace:last-of-type')
  if (!host || !host.classList.contains('is-open')) {
    host = el('div', 'trace is-open')
    transcript.append(host)
  }
  return host
}

function addTrace(event: TraceEvent): void {
  if (event.kind === 'run') return
  const host = traceHost()
  const row = el('div', 'trace-row')
  row.dataset.status = event.status
  row.style.setProperty('--d', String(Math.max(0, event.depth - 1)))
  row.append(el('span', 'dot'))
  const name = el('span', `name${event.kind === 'agent' ? ' agent' : ''}`, event.label)
  row.append(name)
  if (event.detail) row.append(el('span', 'detail', event.detail))
  if (event.ms !== undefined) row.append(el('span', 'ms', `${event.ms}ms`))
  host.append(row)
  scrollDown()
}

function noteOrigin(origin: string, purpose: string): void {
  session.origins.add(origin)
  session.contacted.push({ origin, purpose, at: new Date().toISOString() })
  $('#statusOrigins').textContent = `origins ${session.origins.size}`
}

/* -------------------------------------------------- consent / confirm UI */

function askConsent(opts: {
  title: string
  origin: string
  purpose: string
  fields?: string[]
  args?: Record<string, unknown>
  effect?: string
  confirmLabel: string
  cancelLabel: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    const card = el('div', 'card')
    card.append(el('h3', undefined, opts.effect ? 'Confirm a write' : 'Third-party contact'))
    card.append(el('div', 'card-title', opts.title))
    const dl = el('dl')
    const row = (k: string, v: string) => {
      const d = el('div')
      d.append(el('dt', undefined, k))
      d.append(el('dd', undefined, v))
      dl.append(d)
    }
    row('Destination', opts.origin)
    row('Purpose', opts.purpose)
    if (opts.args) row('Arguments', JSON.stringify(opts.args))
    if (opts.effect) row('Effect', opts.effect)
    if (opts.fields?.length) row('Fields withheld', opts.fields.join(', '))
    card.append(dl)
    if (!opts.effect) {
      card.append(
        el(
          'p',
          'note',
          'Your contact details and frame number stay in this tab. The other site receives only the request text.',
        ),
      )
    } else {
      card.append(el('p', 'note', 'This changes the shop record. Nothing runs until you confirm.'))
    }
    const rowBtns = el('div', 'card-actions')
    const go = el('button', 'btn btn-primary', opts.confirmLabel) as HTMLButtonElement
    const no = el('button', 'btn', opts.cancelLabel) as HTMLButtonElement
    go.type = 'button'
    no.type = 'button'
    rowBtns.append(go, no)
    card.append(rowBtns)
    transcript.append(card)
    scrollDown()

    const finish = (value: boolean) => {
      rowBtns.remove()
      card.append(el('p', 'note', value ? `You chose: ${opts.confirmLabel}.` : `You chose: ${opts.cancelLabel}.`))
      resolve(value)
    }
    go.addEventListener('click', () => finish(true), { once: true })
    no.addEventListener('click', () => finish(false), { once: true })
  })
}

const consent = {
  async request(req: {
    kind: 'peer' | 'action'
    origin: string
    purpose: string
    fields: string[]
    action?: { name: string; effect: string; args: Record<string, unknown> }
  }): Promise<boolean> {
    if (req.kind === 'peer') {
      return askConsent({
        title: 'Ask the trade counter?',
        origin: req.origin,
        purpose: req.purpose,
        fields: ['contact', 'bike_serial'],
        confirmLabel: 'Allow once',
        cancelLabel: 'Not now',
      })
    }
    return askConsent({
      title: `Run ${req.action?.name ?? 'this action'}?`,
      origin: req.origin,
      purpose: req.purpose,
      args: req.action?.args,
      effect: req.action?.effect,
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
    })
  },
}

/* ------------------------------------------------------------------ run */

function runtimeOptions(): RuntimeOptions {
  return {
    provider,
    actions,
    consent,
    peers,
    slyData: SLY_DATA,
    slyRules: SLY_RULES,
    peerPolicy: {
      mode: (manifest.peer_policy?.mode ?? 'closed') as 'open' | 'closed',
      // On localhost the supplier bundle is served from this origin, so the local copy
      // has to be on the list as well as the published CDN URL.
      allow: [...(manifest.allowed_peers ?? []), ...(IS_LOCAL ? [new URL(PEER_URL).origin] : [])],
      deny: manifest.peer_policy?.deny_origins ?? [],
    },
    origin: location.origin,
    onEvent: (e) => {
      addTrace(e)
    },
    onOrigin: noteOrigin,
  }
}

async function ask(text: string): Promise<void> {
  if (busy) return
  const trimmed = text.trim()
  if (!trimmed) return
  busy = true
  document.getElementById('idle')?.remove()
  send.disabled = true
  lamp.classList.add('is-live')
  $('#benchSub').textContent = 'running'
  addMessage('user', trimmed)

  const runtime = new AgentRuntime(runtimeOptions())
  const result = await runtime.runNetwork({ network, frontMan, request: trimmed })

  // The label above the answer is whichever agent actually answered at depth 1.
  const topAgent = [...result.events].reverse().find((e) => e.kind === 'agent' && e.depth === 1)?.agent ?? 'front_desk'
  if (result.text) {
    addMessage('agent', result.text, topAgent.replace(/_/g, ' '))
  } else if (result.error) {
    addMessage('agent', `I stopped: ${result.error}`, 'runtime')
  }
  $('#statusBudget').textContent = `hop ${Math.min(4, result.usage.agentCalls)}/4 · calls ${result.usage.agentCalls + result.usage.actionCalls + result.usage.peerCalls}/12`
  busy = false
  send.disabled = false
  lamp.classList.remove('is-live')
  $('#benchSub').textContent = 'waiting'
  offerNextChips(trimmed)
}

function offerNextChips(last: string): void {
  const chips = $('#chips')
  chips.innerHTML = ''
  const add = (label: string, say: string) => {
    const b = el('button', undefined, label) as HTMLButtonElement
    b.type = 'button'
    b.dataset.say = say
    chips.append(b)
  }
  const booked = /\bbook\b|drop[\s-]?off|bring it in|put it on the bench|reserve/i.test(last)
  if (/derailleur|brake|chain|bracket|cassette|wheel/i.test(last) && !booked) {
    const slot = dropoffSlots(new Date())[0]
    add(`Book ${slot.label.split('·')[0].trim()}`, `Book the ${slot.label.split('·')[0].trim()} slot for the ${partFrom(last).replace(/_/g, ' ')}.`)
  }
  add('Rear derailleur', 'My rear derailleur skips under load. Can you fix it before Friday?')
  add('Brake pads', 'What would new brake pads cost, fitted?')
  add('Track a job', 'Is ticket SS-4C19 ready?')
}

/* --------------------------------------------------------------- panels */

const panel = $('#panel') as unknown as HTMLDialogElement
const panelTitle = $('#panelTitle')
const panelBody = $('#panelBody')

function openPanel(title: string, build: (body: HTMLElement) => void | Promise<void>): void {
  panelTitle.textContent = title
  panelBody.innerHTML = ''
  panel.showModal()
  void build(panelBody)
}

function jsonBlock(value: unknown): HTMLElement {
  const pre = el('pre')
  pre.textContent = JSON.stringify(value, null, 2)
  return pre
}

async function openManifest(): Promise<void> {
  openPanel('agent-manifest.json', (body) => {
    body.append(el('p', undefined, 'Published at the site root. CORS-enabled: any origin can read it.'))
    body.append(jsonBlock(manifest))
    const p = el('p', 'hint')
    p.textContent = `Networks: ${(manifest.networks ?? []).map((n) => n.name).join(', ') || 'none'}`
    body.append(p)
  })
}

async function openModel(): Promise<void> {
  openPanel('Model & key', (body) => {
    const profile = loadProfile()
    body.append(
      el(
        'p',
        undefined,
        'This page runs with a deterministic planner by default: no key, no network. Add an OpenAI-compatible router to run the same network on a real model. The key stays in this origin\'s storage and is sent only to that router.',
      ),
    )
    const form = el('form')
    const field = (label: string, name: string, value: string, type = 'text') => {
      const wrap = el('div', 'field')
      const id = `f-${name}`
      const lab = el('label', undefined, label)
      lab.setAttribute('for', id)
      const inp = el('input') as HTMLInputElement
      inp.id = id
      inp.name = name
      inp.type = type
      inp.value = value
      inp.autocomplete = 'off'
      wrap.append(lab, inp)
      form.append(wrap)
      return inp
    }
    const base = field('Router base URL', 'baseUrl', profile?.baseUrl ?? 'https://api.openai.com/v1')
    const model = field('Model', 'model', profile?.model ?? 'gpt-4.1-mini')
    const key = field('API key', 'apiKey', profile?.apiKey ?? '', 'password')
    const row = el('div', 'row')
    const saveBtn = el('button', 'btn btn-primary', 'Use this model') as HTMLButtonElement
    const localBtn = el('button', 'btn', 'Back to local planner') as HTMLButtonElement
    const clearBtn = el('button', 'btn', 'Clear key') as HTMLButtonElement
    ;[saveBtn, localBtn, clearBtn].forEach((b) => (b.type = 'button'))
    row.append(saveBtn, localBtn, clearBtn)
    form.append(row)
    body.append(form)
    body.append(
      el(
        'p',
        'hint',
        'Requests are sent from this browser straight to the router. A router that does not allow browser CORS calls will fail here; that is the router\'s choice, not a proxy.',
      ),
    )

    saveBtn.addEventListener('click', () => {
      const p: ByokProfile = { baseUrl: base.value.trim(), model: model.value.trim(), apiKey: key.value.trim() }
      if (!p.baseUrl || !p.model) return
      saveProfile(p)
      provider = createByokProvider(p, { onOrigin: noteOrigin })
      $('#statusModel').textContent = `byok · ${p.model}`
      panel.close()
    })
    localBtn.addEventListener('click', () => {
      provider = createLocalPlanner()
      $('#statusModel').textContent = 'local planner'
      panel.close()
    })
    clearBtn.addEventListener('click', () => {
      clearProfile()
      key.value = ''
      provider = createLocalPlanner()
      $('#statusModel').textContent = 'local planner'
    })
  })
}

function openSession(): void {
  openPanel('Session', (body) => {
    body.append(el('h3', undefined, 'Inference'))
    body.append(el('p', undefined, `${provider.label}. ${provider.networked ? 'This provider talks to the network.' : 'This provider makes no network calls.'}`))
    body.append(el('h3', undefined, 'Origins contacted'))
    if (!session.contacted.length) body.append(el('p', undefined, 'None yet. The shop only contacts its parts supplier, and only after you allow it.'))
    else {
      const list = el('div')
      for (const c of session.contacted) {
        const p = el('p', 'mono')
        p.textContent = `${c.origin} — ${c.purpose}`
        list.append(p)
      }
      body.append(list)
    }
    body.append(el('h3', undefined, 'Budgets'))
    body.append(el('p', undefined, 'Composition depth 4 · agent calls 12 · model turns per agent 12 · peer networks 2 · 45 s ceiling.'))
    body.append(el('h3', undefined, 'Private context'))
    body.append(
      el(
        'p',
        undefined,
        'The page holds contact, frame number and the shop trade account. The model never sees them. Only the trade account may pass to Bellwether Parts; the other two are withheld.',
      ),
    )
    const dl = el('dl')
    for (const [k, v] of Object.entries(SLY_DATA)) {
      const d = el('div')
      d.append(el('dt', undefined, k))
      const shown = k === 'contact' ? String(v).replace(/\d{3}$/, '•••') : String(v)
      d.append(el('dd', undefined, shown))
      dl.append(d)
    }
    body.append(dl)
  })
}

/* ---------------------------------------------------------- conformance */

async function openConformance(): Promise<void> {
  openPanel('Conformance', (body) => {
    body.append(
      el(
        'p',
        undefined,
        'The profile\'s MVP interoperability checks, run against this page. Each one executes the real runtime; none of them is a static claim.',
      ),
    )
    const list = el('div')
    body.append(list)
    const results = new Map<string, CheckResult>()
    const rows = CONFORMANCE_CHECKS.map((check) => {
      const row = el('div', 'check')
      row.dataset.state = 'idle'
      const mark = el('span', 'mark', '·')
      const what = el('div')
      what.append(el('span', undefined, check.title))
      what.append(el('span', 'why', check.detail))
      const ref = el('span', 'ref', check.ref)
      row.append(mark, what, ref)
      list.append(row)
      return { check, row, mark }
    })
    const runRow = el('div', 'row')
    const runAll = el('button', 'btn btn-primary', 'Run all checks') as HTMLButtonElement
    runAll.type = 'button'
    runRow.append(runAll)
    body.prepend(runRow)

    const runOne = async (i: number) => {
      const { check, row, mark } = rows[i]
      row.dataset.state = 'run'
      mark.textContent = '…'
      let res: CheckResult
      try {
        res = await check.run({
          manifest,
          network,
          frontMan,
          provider: createLocalPlanner(),
          actions,
          peers,
          slyData: SLY_DATA,
          slyRules: SLY_RULES,
          peerUrl: PEER_URL,
        })
      } catch (err) {
        res = { pass: false, note: `check threw: ${err instanceof Error ? err.message : String(err)}` }
      }
      results.set(check.id, res)
      row.dataset.state = res.pass ? 'pass' : 'fail'
      mark.textContent = res.pass ? '✓' : '✗'
      const why = row.querySelector('.why')
      if (why) why.textContent = `${check.detail} — ${res.note}`
    }

    runAll.addEventListener('click', async () => {
      runAll.disabled = true
      for (let i = 0; i < rows.length; i += 1) await runOne(i)
      runAll.disabled = false
    })
  })
}

/* ----------------------------------------------------------------- routing */

$('#openSession').addEventListener('click', openSession)

document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const which = btn.dataset.open
    if (which === 'manifest') void openManifest()
    if (which === 'model') void openModel()
    if (which === 'conformance') void openConformance()
  })
})

$('#panelClose').addEventListener('click', () => panel.close())

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault()
  const value = input.value
  input.value = ''
  void ask(value)
})

$('#chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-say]')
  if (!btn) return
  void ask(btn.dataset.say ?? '')
})

/* -------------------------------------------------------------------- boot */

function localisePeerUrls(net: NetworkDef): void {
  if (!IS_LOCAL) return
  for (const agent of net.tools ?? []) {
    agent.tools = (agent.tools ?? []).map((ref) => (typeof ref === 'string' && /^https?:/.test(ref) ? PEER_URL : ref))
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return JSON.parse(await res.text())
}

async function boot(): Promise<void> {
  addMessage(
    'agent',
    'Morning. The kettle is on. Ask me about a repair and I will price it from the book, or tell me a ticket number and I will see where your bike is.',
    'front desk',
  )
  // The greeting reads first; the published-graph card sits under it.
  const idle = document.getElementById('idle')
  if (idle) transcript.append(idle)

  try {
    const rawManifest = await fetchJson('agent-manifest.json')
    const check = validateManifest(rawManifest)
    if (!check.ok) throw new Error(check.errors.join('; '))
    manifest = rawManifest as AgentManifest
    const entry = resolveNetworkEntry(manifest, 'saddle_and_spoke', new URL('.', location.href).toString())
    if (!entry.ok) throw new Error(entry.error)
    frontMan = entry.entry.front_man
    const rawNet = await fetchJson(new URL(entry.entry.hocon, new URL('.', location.href)).toString())
    const netCheck = validateNetwork(rawNet, frontMan)
    if (!netCheck.ok) throw new Error(netCheck.errors.join('; '))
    network = rawNet as NetworkDef
    localisePeerUrls(network)
  } catch (err) {
    addMessage('agent', `This page could not read its own published artifacts: ${err instanceof Error ? err.message : String(err)}`, 'runtime')
    return
  }

  const profile = loadProfile()
  if (profile) {
    provider = createByokProvider(profile, { onOrigin: noteOrigin })
    $('#statusModel').textContent = `byok · ${profile.model}`
  } else {
    $('#statusModel').textContent = 'local planner'
  }

  const stored = store.record
  if (stored.tickets.length) {
    const t = stored.tickets[0]
    $('#jobcardNo').textContent = t.ticket
    $('#jobFor').textContent = PARTS.find((p) => p.id === t.partId)?.name ?? 'Repair'
    $('#jobWork').textContent = t.slot
    $('#jobPrice').textContent = t.quote ? money(t.quote) : '—'
    $('#jobReady').textContent = t.ready
    $('#jobcard').classList.add('is-filled')
  }
  if (stored.highlight) setSpotlight(stored.highlight)
}

void boot()

/* a small helper used by the spec's own acceptance tests */
declare global {
  interface Window {
    __shop?: {
      ask: (text: string) => Promise<void>
      store: ShopStore
      setSpotlight: (id: string | null) => void
      quote: typeof quoteRepair
    }
  }
}

window.__shop = { ask, store, setSpotlight, quote: quoteRepair }
