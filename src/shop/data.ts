/**
 * The shop's own facts. Everything an agent can say about price, stock or timing comes
 * from here — never from the model. The page and the site actions read the same object.
 */

export interface Part {
  id: string
  name: string
  sku: string
  price: number
  labourHours: number
  stock: number
  note: string
}

export const LABOUR_RATE = 45 // £ per hour

export const PARTS: Part[] = [
  { id: 'rear_derailleur', name: 'Rear derailleur', sku: 'SHIMANO RD-M310', price: 26, labourHours: 0.9, stock: 0, note: '7/8-speed, direct mount' },
  { id: 'derailleur_hanger', name: 'Derailleur hanger', sku: 'DROPOUT-114', price: 14, labourHours: 0.2, stock: 0, note: 'Fits most steel tourers; universal dropout' },
  { id: 'shift_cable', name: 'Shift cable + housing', sku: 'JAGWIRE 1.1', price: 6, labourHours: 0.2, stock: 12, note: 'Stainless, 2.2 m' },
  { id: 'chain', name: 'Chain', sku: 'KMC X8', price: 22, labourHours: 0.5, stock: 4, note: '8-speed, 116 links' },
  { id: 'brake_pads', name: 'Brake pads (pair)', sku: 'SWISSSTOP DURA', price: 12, labourHours: 0.3, stock: 8, note: 'For rim brakes' },
  { id: 'cassette', name: 'Cassette', sku: 'CS-HG200-8', price: 28, labourHours: 0.4, stock: 2, note: '11–34t' },
  { id: 'bottom_bracket', name: 'Bottom bracket', sku: 'SHIMANO BB-UN300', price: 24, labourHours: 0.7, stock: 1, note: 'BSA 68 mm, square taper' },
  { id: 'rear_wheel', name: 'Rear wheel', sku: 'HANDBUILT 36H', price: 65, labourHours: 0.3, stock: 1, note: 'Built in-house on a Deore hub' },
]

export interface QueueItem {
  ticket: string
  bike: string
  work: string
  ready: string
}

export const QUEUE: QueueItem[] = [
  { ticket: 'SS-4C19', bike: 'Bullitt cargo', work: 'Wheel build, rear', ready: 'Wed 18:00' },
  { ticket: 'SS-4D07', bike: 'Raleigh Record', work: 'Bottom bracket', ready: 'Thu 12:00' },
  { ticket: 'SS-4E31', bike: 'Stayer Groadinger', work: 'Brake bleed', ready: 'Thu 16:00' },
]

export const POLICIES = [
  'We do not service e-bike batteries or motors. Mechanical work on e-bikes is fine.',
  'Bikes left more than 14 days after we call you are sold to cover the bench.',
  'We quote labour in half-hour blocks at £45/hour. Parts are at list price.',
  'We do not take payment online. Pay when you collect.',
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dayLabel(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`
}

/** The next Thursday 17:30 and the Friday after it, computed from the visitor's clock. */
export function dropoffSlots(now: Date): Array<{ id: string; label: string; date: string; ready: string; note: string }> {
  const thu = new Date(now)
  const delta = (4 - thu.getDay() + 7) % 7 || 7
  thu.setDate(thu.getDate() + delta)
  thu.setHours(17, 30, 0, 0)
  const fri = new Date(thu)
  fri.setDate(fri.getDate() + 1)
  fri.setHours(8, 15, 0, 0)
  return [
    {
      id: 'thu-1730',
      label: `Thu ${thu.getDate()} ${thu.toLocaleString('en-GB', { month: 'short' })} · 17:30`,
      date: iso(thu),
      ready: 'Fri 17:00',
      note: 'The supplier van lands Friday morning, so the hanger is on the bench by 10.',
    },
    {
      id: 'fri-0815',
      label: `Fri ${fri.getDate()} ${fri.toLocaleString('en-GB', { month: 'short' })} · 08:15`,
      date: iso(fri),
      ready: 'Mon 12:00',
      note: 'We are closed at the weekend, so a Friday drop-off waits until Monday.',
    },
  ]
}

export interface Quote {
  partId: string
  partName: string
  symptom: string
  labourHours: number
  labour: number
  lines: Array<{ sku: string; name: string; price: number; inStock: boolean }>
  total: number
  readyBy: string
  note: string
}

export function quoteRepair(partId: string, symptom: string, now: Date): Quote | null {
  const part = PARTS.find((p) => p.id === partId)
  if (!part) return null
  const lines: Quote['lines'] = []
  // A derailleur swap always needs a fresh cable; a hanger is only needed if the old one
  // is bent, which is what "skips under load" usually means on a steel dropout.
  if (part.id === 'rear_derailleur') {
    const hanger = PARTS.find((p) => p.id === 'derailleur_hanger')!
    const cable = PARTS.find((p) => p.id === 'shift_cable')!
    lines.push({ sku: hanger.sku, name: hanger.name, price: hanger.price, inStock: hanger.stock > 0 })
    lines.push({ sku: cable.sku, name: cable.name, price: cable.price, inStock: cable.stock > 0 })
  }
  lines.unshift({ sku: part.sku, name: part.name, price: part.price, inStock: part.stock > 0 })
  const labour = Math.round(part.labourHours * LABOUR_RATE * 100) / 100
  const total = Math.round((labour + lines.reduce((s, l) => s + l.price, 0)) * 100) / 100
  const outOfStock = lines.some((l) => !l.inStock)
  const slots = dropoffSlots(now)
  return {
    partId: part.id,
    partName: part.name,
    symptom,
    labourHours: part.labourHours,
    labour,
    lines,
    total,
    readyBy: slots[0].ready,
    note: outOfStock
      ? 'Not every line is on the shelf. The trade counter normally has these in two days.'
      : 'All lines are on the shelf.',
  }
}

export function partsCatalogue(): Array<Pick<Part, 'id' | 'name' | 'sku' | 'price' | 'stock' | 'note'>> {
  return PARTS.map(({ id, name, sku, price, stock, note }) => ({ id, name, sku, price, stock, note }))
}

export function shopState(now: Date) {
  return {
    shop: 'Saddle & Spoke',
    address: '24 Ashfield Lane',
    today: dayLabel(now),
    todayIso: iso(now),
    hours: 'Tue–Fri 08:00–18:00 · Sat 09:00–13:00 · closed Sun–Mon',
    phone: '+44 20 7946 0311',
    labourRate: LABOUR_RATE,
    queue: QUEUE,
    parts: partsCatalogue(),
    policies: POLICIES,
    dropoffSlots: dropoffSlots(now),
  }
}
