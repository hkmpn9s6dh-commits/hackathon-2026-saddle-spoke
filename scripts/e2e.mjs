#!/usr/bin/env node
/**
 * End-to-end checks against the built site.
 *
 * Every assertion here maps to an acceptance condition in docs/01-SPEC.md. Run it against
 * a preview server: `npm run e2e` (which builds, serves, and runs this file).
 */
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')
const url = process.env.SITE_URL ?? 'http://localhost:4173/'
const shots = 'proof/shots'
mkdirSync(shots, { recursive: true })

const results = []
function check(id, ok, note) {
  results.push({ id, ok, note })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${note}`)
}

const browser = await chromium.launch({ executablePath: exe })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors = []
const requests = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('request', (r) => requests.push(r.url()))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)

/* AC-1: the published artifacts are all reachable ------------------------- */
for (const path of [
  'agent-manifest.json',
  'saddle_and_spoke.network.json',
  'links.json',
  'peer/agent-manifest.json',
  'peer/bellwether_parts.network.json',
]) {
  const res = await page.request.get(new URL(path, url).toString())
  check('AC-1 ' + path, res.ok(), `status ${res.status()}`)
}

/* AC-3: default inference, no key ------------------------------------------ */
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('saddle-and-spoke/v1') ?? '{"tickets":[]}').tickets.length)
await page.fill('#say', 'My rear derailleur skips under load. Can you fix it before Friday?')
await page.press('#say', 'Enter')
await page.waitForSelector('.trace-row', { timeout: 15000 })
await page.waitForTimeout(600)

const traceText = await page.locator('.trace').first().innerText()
check('AC-3 trace has highlight_part', /website_highlight_part/.test(traceText), 'delegation + action visible in the bench')
const lit = await page.locator('.part[data-part="rear_derailleur"]').evaluate((el) => el.classList.contains('is-lit'))
check('AC-3 derailleur lit', lit, 'the drawing marks the part the agent named')
const job = await page.locator('#jobcard').innerText()
check('AC-3 job card priced', /£\d/.test(job), job.replace(/\s+/g, ' ').slice(0, 80))
await page.screenshot({ path: `${shots}/e2e-1-quote.png` })

/* AC-4: cross-origin peer, consent, withheld fields ------------------------ */
const consent = page.locator('.card', { hasText: 'Ask the trade counter?' })
await consent.waitFor({ timeout: 15000 })
const consentText = await consent.innerText()
check('AC-4 consent names the destination', /localhost|jsdelivr/.test(consentText), consentText.split('\n').slice(0, 3).join(' | '))
check('AC-4 withheld fields listed', /contact, bike_serial/.test(consentText), 'the card says what stays in the tab')
await consent.locator('button', { hasText: 'Allow once' }).click()
// The peer runs asynchronously; wait for the runtime's own accounting to appear.
await page
  .waitForFunction(() => document.body.innerText.includes('sly_data to peer'), { timeout: 20000 })
  .catch(() => {})
await page.waitForTimeout(400)
const afterConsent = await page.locator('.transcript').innerText()
check('AC-4 peer loaded and answered', /load bellwether_parts/.test(afterConsent) && /on the shelf/.test(afterConsent), 'peer network ran in this tab')
check('AC-4 sly accounting', /sent: trade_account/.test(afterConsent) && /withheld: contact, bike_serial/.test(afterConsent), 'runtime reports what it sent')
await page.screenshot({ path: `${shots}/e2e-2-peer.png` })

/* AC-5: a write needs confirmation and produces a receipt ------------------ */
const slotChip = page.locator('#chips button', { hasText: /^Book/ })
await slotChip.waitFor({ timeout: 5000 })
await slotChip.click()
const confirm = page.locator('.card', { hasText: 'Run book_dropoff?' })
await confirm.waitFor({ timeout: 15000 })
const duringConfirm = await page.evaluate(() => JSON.parse(localStorage.getItem('saddle-and-spoke/v1') ?? '{"tickets":[]}').tickets.length)
check('AC-5 write not applied before confirm', duringConfirm === before, `${duringConfirm} tickets before confirming`)
await confirm.locator('button', { hasText: 'Confirm' }).click()
await page.waitForSelector('.receipt', { timeout: 15000 })
const receipt = await page.locator('.receipt').last().innerText()
check('AC-5 receipt with confirmed outcome', /SS-[A-Z0-9]{4}/.test(receipt) && /confirmed/i.test(receipt), receipt.replace(/\s+/g, ' ').slice(0, 60))
const afterTickets = await page.evaluate(() => JSON.parse(localStorage.getItem('saddle-and-spoke/v1') ?? '{"tickets":[]}').tickets.length)
check('AC-5 ticket written after confirm', afterTickets === before + 1, `${afterTickets} tickets`)
await page.screenshot({ path: `${shots}/e2e-3-receipt.png` })

/* AC-6: the conformance panel actually runs ------------------------------- */
await page.click('[data-open="conformance"]')
await page.click('button:has-text("Run all checks")')
await page.waitForFunction(
  () => document.querySelectorAll('.check[data-state="pass"], .check[data-state="fail"]').length === 7,
  { timeout: 60000 },
)
const checks = await page.locator('.check').evaluateAll((els) =>
  els.map((e) => ({ state: e.dataset.state, text: e.querySelector('.why')?.textContent ?? '' })),
)
const failed = checks.filter((c) => c.state !== 'pass')
check('AC-6 all seven conformance checks pass', failed.length === 0, failed.map((f) => f.text.slice(0, 60)).join(' | ') || '7/7')
await page.screenshot({ path: `${shots}/e2e-4-conformance.png` })
await page.click('#panelClose')

/* AC-7: no outbound requests without a key -------------------------------- */
const foreign = requests.filter((u) => {
  const host = new URL(u).host
  const self = new URL(url).host
  return host !== self && !host.endsWith('jsdelivr.net')
})
check('AC-7 no third-party requests without a key', foreign.length === 0, foreign.slice(0, 3).join(', ') || 'none')

/* AC-8: state survives a reload; keys can be removed --------------------- */
await page.reload({ waitUntil: 'networkidle' })
const persisted = await page.locator('#jobcardNo').innerText()
check('AC-8 job card survives reload', /SS-[A-Z0-9]{4}/.test(persisted), persisted)
await page.click('[data-open="model"]')
await page.fill('#f-apiKey', 'sk-test-do-not-send')
await page.fill('#f-model', 'gpt-4.1-mini')
await page.click('button:has-text("Use this model")')
const stored = await page.evaluate(() => localStorage.getItem('saddle-and-spoke/byok/v1'))
check('AC-8 key stored in this origin', Boolean(stored), stored ? 'present' : 'missing')
await page.click('[data-open="model"]')
await page.click('button:has-text("Clear key")')
const cleared = await page.evaluate(() => localStorage.getItem('saddle-and-spoke/byok/v1'))
check('AC-8 clear key removes it', cleared === null, String(cleared))

check('console clean', errors.length === 0, errors.slice(0, 3).join(' | ') || 'no errors')

await browser.close()

const failedCount = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failedCount}/${results.length} checks passed`)
process.exit(failedCount === 0 ? 0 : 1)
