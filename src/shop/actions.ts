/**
 * The shop's site actions. These are the only way an agent can read or change anything
 * on this page. Each one wraps an operation the page itself uses, so the assistant and
 * the visitor cannot get different answers.
 */
import { PARTS, dropoffSlots, quoteRepair, shopState } from './data'
import type { ShopStore } from './store'
import { newId } from './store'
import type { SiteActionDef } from '../runtime/types'

export interface ShopBridge {
  highlight(partId: string | null): void
  jobCard(quote: ReturnType<typeof quoteRepair>): void
  receipt(receipt: { id: string; summary: string }): void
}

const PART_IDS = PARTS.map((p) => p.id)

export function createShopActions(opts: { store: ShopStore; bridge: ShopBridge }): SiteActionDef[] {
  const { store, bridge } = opts

  return [
    {
      name: 'get_shop_state',
      description:
        'Read the shop: today, opening hours, the work queue and what each bike needs, the parts catalogue with shelf stock, prices, the two drop-off slots, and the shop policies. Read this before quoting or booking.',
      effect: 'read',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: (_args, ctx) => ({ ok: true, data: shopState(ctx.now) }),
    },
    {
      name: 'highlight_part',
      description:
        'Point at one part on the bicycle drawing. The page dims and a brass ring settles on that part with its name and part number. Use it whenever you name a part, so the visitor can see which one you mean. It changes nothing else.',
      effect: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          part: { type: 'string', enum: PART_IDS, description: 'Part id from get_shop_state.' },
        },
        required: ['part'],
        additionalProperties: false,
      },
      execute: (args) => {
        const id = String(args.part)
        const part = PARTS.find((p) => p.id === id)
        if (!part) return { ok: false, reason: `no part with id "${id}" on this bike` }
        store.highlight(id)
        bridge.highlight(id)
        return { ok: true, data: { lit: part.id, name: part.name, sku: part.sku } }
      },
    },
    {
      name: 'quote_repair',
      description:
        'Price a repair from the shop price list: labour at £45/hour plus the parts the job needs. Returns the lines, the total, whether each line is on the shelf, and the earliest collection time. It does not reserve anything.',
      effect: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          part: { type: 'string', enum: PART_IDS, description: 'The part the job is about.' },
          symptom: { type: 'string', description: 'What the visitor says is wrong, in their words.' },
        },
        required: ['part', 'symptom'],
        additionalProperties: false,
      },
      execute: (args, ctx) => {
        const quote = quoteRepair(String(args.part), String(args.symptom), ctx.now)
        if (!quote) return { ok: false, reason: `no part with id "${String(args.part)}"` }
        store.setQuote(quote)
        bridge.jobCard(quote)
        return { ok: true, data: quote }
      },
    },
    {
      name: 'check_dropoff_slots',
      description:
        'List the two drop-off slots the bench can take, with the collection time each one leads to and why. Use it before offering a time to the visitor.',
      effect: 'read',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: (_args, ctx) => {
        const slots = dropoffSlots(ctx.now).map((s) => ({ id: s.id, label: s.label, ready: s.ready, note: s.note }))
        return { ok: true, data: { slots } }
      },
    },
    {
      name: 'book_dropoff',
      description:
        'Book the bike in for one of the drop-off slots. This writes a job card and cannot be undone from this page. The visitor sees the destination, the arguments and the effect before it runs, and gets a receipt with an outcome.',
      effect: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          slot: { type: 'string', description: 'Slot id from check_dropoff_slots, such as "thu-1730".' },
          part: { type: 'string', enum: PART_IDS, description: 'The part the job is about.' },
        },
        required: ['slot', 'part'],
        additionalProperties: false,
      },
      execute: (args, ctx) => {
        const slot = dropoffSlots(ctx.now).find((s) => s.id === args.slot)
        if (!slot) {
          return { ok: false, reason: `"${String(args.slot)}" is not a drop-off slot the bench is offering` }
        }
        // Contact details come from the page's private context. The model never sees
        // them, so they are not arguments it could repeat, log or send anywhere else.
        const contact = String(ctx.sly.contact ?? '').trim()
        const bikeSerial = String(ctx.sly.bike_serial ?? '').trim()
        if (contact.length < 5) {
          return { ok: false, reason: 'the page has no contact details in private context; the visitor must add them on the page first' }
        }
        if (bikeSerial.length < 4) {
          return { ok: false, reason: 'the page has no frame number in private context; the visitor must add it on the page first' }
        }
        const quote = store.record.lastQuote
        const ticket = newId('SS')
        store.addTicket({
          ticket,
          slot: slot.label,
          ready: slot.ready,
          contact,
          bikeSerial,
          quote: quote?.total ?? 0,
          partId: String(args.part),
        })
        const summary = `Drop-off ${slot.label} · ready ${slot.ready}`
        bridge.receipt({ id: ticket, summary })
        return {
          ok: true,
          data: {
            receipt_id: ticket,
            outcome: 'confirmed',
            slot: slot.label,
            ready: slot.ready,
            estimated_total: quote?.total ?? null,
            note: 'The shop has this card on the bench. Pay when you collect.',
          },
        }
      },
    },
    {
      name: 'order_part',
      description:
        'Put a part on the shop order book so it is on the next supplier van. Writes state; the visitor confirms first and gets a receipt.',
      effect: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          part: { type: 'string', enum: PART_IDS },
          qty: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['part', 'qty'],
        additionalProperties: false,
      },
      execute: (args) => {
        const part = PARTS.find((p) => p.id === args.part)
        if (!part) return { ok: false, reason: `no part with id "${String(args.part)}"` }
        const orderId = newId('PO')
        store.addOrder({ orderId, part: part.id, qty: Number(args.qty), at: new Date().toISOString() })
        bridge.receipt({ id: orderId, summary: `${args.qty} × ${part.name} on the next van` })
        return { ok: true, data: { receipt_id: orderId, outcome: 'confirmed', part: part.name, qty: args.qty } }
      },
    },
    {
      name: 'lookup_ticket',
      description: 'Look up a job card by its ticket number, for example SS-4F2A.',
      effect: 'read',
      inputSchema: {
        type: 'object',
        properties: { ticket: { type: 'string', description: 'Ticket number from a receipt.' } },
        required: ['ticket'],
        additionalProperties: false,
      },
      execute: (args) => {
        const found = store.findTicket(String(args.ticket))
        if (!found) return { ok: false, reason: `no job card numbered "${String(args.ticket)}" in this browser` }
        return { ok: true, data: found }
      },
    },
  ]
}
