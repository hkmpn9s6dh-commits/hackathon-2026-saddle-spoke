/**
 * The page's own state: job cards, orders and the current highlight.
 *
 * This is a real little database, not a demo fixture: a booking survives a reload, and
 * the queue on the wall reads the same list the agent writes to.
 */
import type { Quote } from './data'

export interface Receipt {
  receiptId: string
  kind: 'dropoff' | 'order'
  at: string
  outcome: 'confirmed'
  summary: string
  args: Record<string, unknown>
}

export interface ShopRecord {
  tickets: Array<{
    ticket: string
    slot: string
    ready: string
    contact: string
    bikeSerial: string
    quote: number
    partId: string
  }>
  orders: Array<{ orderId: string; part: string; qty: number; at: string }>
  lastQuote: Quote | null
  highlight: string | null
}

const KEY = 'saddle-and-spoke/v1'

function empty(): ShopRecord {
  return { tickets: [], orders: [], lastQuote: null, highlight: null }
}

export class ShopStore {
  private data: ShopRecord

  constructor(private readonly storage: Storage | null = globalThis.localStorage ?? null) {
    this.data = this.read()
  }

  private read(): ShopRecord {
    try {
      const raw = this.storage?.getItem(KEY)
      if (!raw) return empty()
      const parsed = JSON.parse(raw) as Partial<ShopRecord>
      return { ...empty(), ...parsed }
    } catch {
      return empty()
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data))
    } catch {
      /* private mode: the page still works, it just forgets on reload */
    }
  }

  get record(): ShopRecord {
    return this.data
  }

  setQuote(quote: Quote): void {
    this.data.lastQuote = quote
    this.write()
  }

  highlight(partId: string | null): void {
    this.data.highlight = partId
    this.write()
  }

  addTicket(t: ShopRecord['tickets'][number]): void {
    this.data.tickets.unshift(t)
    this.write()
  }

  addOrder(o: ShopRecord['orders'][number]): void {
    this.data.orders.unshift(o)
    this.write()
  }

  findTicket(id: string) {
    const key = id.trim().toUpperCase()
    return this.data.tickets.find((t) => t.ticket === key) ?? null
  }

  reset(): void {
    this.data = empty()
    this.write()
  }
}

/** Short, human-quotable ids: SS-4F2A. */
export function newId(prefix: string, rand: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 4; i += 1) out += alphabet[Math.floor(rand() * alphabet.length)]
  return `${prefix}-${out}`
}
