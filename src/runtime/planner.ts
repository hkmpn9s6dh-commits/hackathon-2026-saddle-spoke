/**
 * The default inference path: a deterministic planner that runs in the tab.
 *
 * It is not a language model and the page says so. What it does is real work: it reads
 * the published network, picks the next agent or action from the tools the runtime
 * offered, and composes an answer from tool results only. That makes the site usable
 * with no key and no network, which is what a visitor — or a judge — meets first.
 *
 * The same network runs unchanged on a real model through BYOK.
 */
import type { ModelMessage, ModelProvider, ModelTurn } from './types'

type Role = 'front_desk' | 'workshop_lead' | 'parts_desk' | 'trade_counter' | 'stock_keeper' | 'other'

const PART_HINTS: Array<[RegExp, string]> = [
  [/hanger|dropout/i, 'derailleur_hanger'],
  [/derailleur|rear mech|mech\b|shifter|skips|skipping|gears?\b/i, 'rear_derailleur'],
  [/cassette|sprocket|block\b/i, 'cassette'],
  [/bottom bracket|crank|bb\b/i, 'bottom_bracket'],
  [/brake|pad\b/i, 'brake_pads'],
  [/wheel|rim\b|spoke/i, 'rear_wheel'],
  [/chain/i, 'chain'],
  [/cable/i, 'shift_cable'],
]

export function partFrom(text: string): string {
  for (const [re, id] of PART_HINTS) if (re.test(text)) return id
  return 'rear_derailleur'
}

const PART_NAMES: Record<string, string> = {
  rear_derailleur: 'rear derailleur',
  derailleur_hanger: 'derailleur hanger',
  shift_cable: 'shift cable',
  chain: 'chain',
  brake_pads: 'brake pads',
  cassette: 'cassette',
  bottom_bracket: 'bottom bracket',
  rear_wheel: 'rear wheel',
}

function roleOf(system: string): Role {
  const head = system.split('\n')[0].trim()
  if (head === 'front_desk') return 'front_desk'
  if (head === 'workshop_lead') return 'workshop_lead'
  if (head === 'parts_desk') return 'parts_desk'
  if (head === 'trade_counter') return 'trade_counter'
  if (head === 'stock_keeper') return 'stock_keeper'
  if (system.includes('front desk at Saddle')) return 'front_desk'
  if (system.includes('workshop lead')) return 'workshop_lead'
  if (system.includes('parts desk')) return 'parts_desk'
  if (system.includes('trade counter at Bellwether')) return 'trade_counter'
  if (system.includes('stock list at Bellwether')) return 'stock_keeper'
  return 'other'
}

function money(n: number): string {
  return '£' + n.toFixed(2).replace(/\.00$/, '')
}

interface Called {
  names: string[]
  last: Map<string, unknown>
}

function readCalls(messages: ModelMessage[]): Called {
  const names: string[] = []
  const last = new Map<string, unknown>()
  for (const m of messages) {
    if (m.role !== 'tool' || !m.name) continue
    names.push(m.name)
    const text = m.content.trim()
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as { status?: string; result?: unknown }
        if (parsed.status === 'succeeded') last.set(m.name, parsed.result)
      } catch {
        /* prose result */
      }
    }
    if (!last.has(m.name)) last.set(m.name, text)
  }
  return { names, last }
}

const SLOT_HINTS: Array<[RegExp, string]> = [
  [/thu/i, 'thu-1730'],
  [/fri/i, 'fri-0815'],
]

function slotFrom(text: string): string | null {
  for (const [re, id] of SLOT_HINTS) if (re.test(text)) return id
  return null
}

export function createLocalPlanner(): ModelProvider {
  return {
    id: 'local-planner',
    label: 'Local planner · deterministic, no key',
    networked: false,
    async chat({ system, messages, tools }): Promise<ModelTurn> {
      const role = roleOf(system)
      const request = messages.find((m) => m.role === 'user')?.content ?? ''
      const { names, last } = readCalls(messages)
      const has = (n: string) => tools.some((t) => t.name === n)
      const call = (name: string, args: Record<string, unknown>): ModelTurn => ({
        toolCalls: [{ id: `c${names.length + 1}`, name, args }],
      })
      const callOnce = (name: string, args: Record<string, unknown>): ModelTurn | null =>
        has(name) && !names.includes(name) ? call(name, args) : null

      if (role === 'front_desk') {
        const wantsLookup = /ticket|SS-[A-Z0-9]{4}|\bready\b|status of/i.test(request)
        if (wantsLookup) {
          const ticket = (request.match(/SS-[A-Z0-9]{4}/i)?.[0] ?? '').toUpperCase()
          const first = callOnce('website_lookup_ticket', { ticket })
          if (first) return first
          const found = last.get('website_lookup_ticket')
          if (found && typeof found === 'object') {
            const t = found as Record<string, string>
            return { text: `${t.ticket} — ${t.bike}, ${t.work}. It's ready ${t.ready}.` }
          }
          return { text: `I can't find that card in this browser. Job cards made online live in the tab that made them; ring the shop on +44 20 7946 0311 and we'll look it up.` }
        }

        if (!names.includes('website_get_shop_state')) {
          const first = callOnce('website_get_shop_state', {})
          if (first) return first
        }

        // A day name alone is not a booking: "before Friday" is a question about timing.
        const wantsBook = /\bbook\b|drop[\s-]?off|bring it in|put it on the bench|reserve/i.test(request)
        if (wantsBook) {
          const slot = slotFrom(request) ?? 'thu-1730'
          const first = callOnce('website_book_dropoff', { slot, part: partFrom(request) })
          if (first) return first
          const receipt = last.get('website_book_dropoff')
          if (receipt && typeof receipt === 'object') {
            const r = receipt as Record<string, unknown>
            return {
              text: `Booked. Card ${String(r.receipt_id)} is on the bench for ${String(r.slot)}, ready ${String(r.ready)}. ${
                r.estimated_total ? `That's ${money(Number(r.estimated_total))} unless we find something else once it's apart. ` : ''
              }Pay when you collect.`,
            }
          }
          return { text: `I couldn't book that one — the page refused it. Nothing has changed; tell me the day again and I'll try once more.` }
        }

        const workshop = last.get('workshop_lead')
        if (!workshop) {
          const first = callOnce('workshop_lead', { request })
          if (first) return first
        }
        const workshopText = typeof workshop === 'string' ? workshop : ''
        const needsTrade = /not on the shelf|isn't on the shelf|out of stock|trade counter/i.test(workshopText)
        if (needsTrade && !names.includes('parts_desk')) {
          const first = callOnce('parts_desk', { request })
          if (first) return first
        }
        if (workshopText && !names.includes('website_check_dropoff_slots')) {
          const first = callOnce('website_check_dropoff_slots', {})
          if (first) return first
        }

        const slots = last.get('website_check_dropoff_slots') as
          | { slots: Array<{ id: string; label: string; ready: string }> }
          | undefined
        if (!workshopText) {
          return {
            text: 'I can price that, book the bike in, or check whether a part is on the shelf. Which one do you need?',
          }
        }
        const body = workshopText.replace(/\s*Earliest collection[^.]*\.\s*$/, '').trim()
        const s0 = slots?.slots?.[0]
        const s1 = slots?.slots?.[1]
        const offer = s0
          ? `Drop it in ${s0.label} and it's back with you ${s0.ready}${s1 ? `, or ${s1.label} for ${s1.ready}` : ''}. Want me to put it on the bench for the ${s0.label.split('·')[0].trim()} slot?`
          : 'Ring the shop on +44 20 7946 0311 and we will find a time.'
        return { text: `${body} ${offer}` }
      }

      if (role === 'workshop_lead') {
        const part = partFrom(request)
        const first = callOnce('website_highlight_part', { part })
        if (first) return first
        const second = callOnce('website_quote_repair', { part, symptom: request })
        if (second) return second
        const third = callOnce('website_check_dropoff_slots', {})
        if (third) return third
        const quote = last.get('website_quote_repair') as
          | { total: number; labour: number; labourHours: number; partName: string; lines: Array<{ name: string; price: number; inStock: boolean }>; readyBy: string }
          | undefined
        const slots = last.get('website_check_dropoff_slots') as { slots: Array<{ id: string; label: string; ready: string }> } | undefined
        if (!quote) return { text: 'I could not price that from the book.' }
        const out = quote.lines.filter((l) => !l.inStock).map((l) => l.name.toLowerCase())
        const partsList = quote.lines.map((l) => `${l.name.toLowerCase()} ${money(l.price)}`).join(', ')
        const stock = out.length
          ? `${out.join(' and ')} ${out.length > 1 ? "aren't" : "isn't"} on the shelf; the trade counter brings ${out.length > 1 ? 'them' : 'it'} in two days.`
          : 'All lines are on the shelf.'
        return {
          text:
            `${money(quote.total)} all in — ${quote.labourHours}h labour plus ${partsList}. ` +
            `${stock.charAt(0).toUpperCase()}${stock.slice(1)} ` +
            `Earliest collection ${slots?.slots?.[0]?.ready ?? quote.readyBy}.`,
        }
      }

      if (role === 'parts_desk') {
        const part = partFrom(request)
        const first = callOnce('website_get_shop_state', {})
        if (first) return first
        const state = last.get('website_get_shop_state') as
          | { parts: Array<{ id: string; name: string; stock: number; sku: string }> }
          | undefined
        const row = state?.parts.find((p) => p.id === part)
        if (row && row.stock > 0) {
          return { text: `${row.name} ${row.sku}: ${row.stock} on the shelf. No need to order.` }
        }
        const peer = has('bellwether_parts') ? callOnce('bellwether_parts', { request: `Stock, lead time and trade price for ${part}, please.` }) : null
        if (peer) return peer
        const answer = last.get('bellwether_parts')
        if (typeof answer === 'string') {
          return { text: `Shelf is out of ${row?.name.toLowerCase() ?? part}. Trade counter: ${answer}` }
        }
        return { text: `Shelf is out of ${row?.name.toLowerCase() ?? part}, and the trade counter did not answer.` }
      }

      if (role === 'trade_counter') {
        const next = callOnce('stock_keeper', { request })
        if (next) return next
        const answer = last.get('stock_keeper')
        return { text: typeof answer === 'string' ? answer : 'I cannot check that line right now.' }
      }

      if (role === 'stock_keeper') {
        const table = readStockTable(system)
        const part = partFrom(request)
        const row = table.find((r) => r.id === part) ?? table.find((r) => request.toUpperCase().includes(r.sku))
        if (!row) return { text: 'We do not carry that line.' }
        return {
          text: `${row.sku} — ${row.shelf} on the shelf, ${row.lead_days} days when empty, ${money(row.trade)} trade.`,
        }
      }

      return { text: 'I am not sure which desk you need.' }
    },
  }
}

interface StockRow {
  id: string
  sku: string
  name: string
  shelf: number
  lead_days: number
  trade: number
}

/** The peer publishes its stock as data inside its own network definition. */
function readStockTable(system: string): StockRow[] {
  const match = system.match(/```json\s*([\s\S]*?)```/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1]) as { items?: StockRow[] }
    return parsed.items ?? []
  } catch {
    return []
  }
}

export { PART_NAMES }
