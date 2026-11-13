#!/usr/bin/env node
/**
 * Records the demonstration film.
 *
 * Every frame is the real product: the typing is typed, the cards are clicked, the
 * conformance checks really run. Captions and the two cards are the only things added,
 * and they are added inside the page so the recording needs no compositing.
 *
 *   node scripts/demo.mjs [--url …] [--out video/saddle-and-spoke-demo.webm]
 */
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : fallback
}
const url = arg('--url', 'http://localhost:4173/')
const outPath = arg('--out', 'video/saddle-and-spoke-demo.webm')
const exe = process.env.PLAYWRIGHT_CHROMIUM ?? join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')

const rawDir = 'video/raw'
rmSync(rawDir, { recursive: true, force: true })
mkdirSync(rawDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: rawDir, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

/* the film's own furniture, injected into the page */
await page.addStyleTag({
  content: `
    /* The page is scaled down so the caption band never covers the product. */
    .app { zoom: .915; }
    body { overflow: hidden; }
    .film-caption {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 9000;
      height: 76px; display: flex; align-items: center;
      padding: 0 120px 0 60px;
      background: #0a0907;
      border-top: 1px solid rgba(217,160,90,.3);
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 17px; line-height: 1.4; letter-spacing: -0.005em;
      color: #f0eade; opacity: 0; transition: opacity .28s ease;
      pointer-events: none;
    }
    .film-caption.on { opacity: 1; }
    .film-caption b { color: #d9a05a; font-weight: 600; }
    .film-card {
      position: fixed; inset: 0; z-index: 9500; display: none;
      place-items: center; background: #f3eee4; color: #17140f;
    }
    .film-card.on { display: grid; }
    .film-card .inner { max-width: 880px; padding: 0 60px; }
    .film-card .kick {
      font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: .18em;
      text-transform: uppercase; color: #6d6353; margin: 0 0 22px;
    }
    .film-card h2 {
      font-family: 'Fraunces', Georgia, serif; font-weight: 600; letter-spacing: -0.03em;
      font-size: 74px; line-height: 1.0; margin: 0 0 22px;
    }
    .film-card h2 em { font-style: italic; color: #a8621f; }
    .film-card p { font-size: 18px; line-height: 1.5; color: #3b352b; margin: 0; max-width: 44ch; }
    .film-card.dark { background: #100e0b; color: #e8e2d6; }
    .film-card.dark .kick { color: #8a8272; }
    .film-card.dark h2 { color: #f3eee4; font-size: 54px; }
    .film-card.dark p { color: #a89e8b; }
    .film-card .mono { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #a8621f; letter-spacing: .02em; display: inline-block; white-space: nowrap; }
    .film-card.dark .mono { color: #d9a05a; }
  `,
})

await page.addScriptTag({
  content: `
    const cap = document.createElement('div');
    cap.className = 'film-caption';
    document.body.appendChild(cap);
    window.__film = {
      say(text) {
        cap.textContent = text;
        cap.classList.add('on');
      },
      mute() { cap.classList.remove('on'); },
      card(html) {
        let el = document.querySelector('.film-card');
        if (!el) { el = document.createElement('div'); el.className = 'film-card'; document.body.appendChild(el); }
        el.innerHTML = '<div class="inner">' + html + '</div>';
        el.classList.add('on');
      },
      hideCard() { document.querySelector('.film-card')?.classList.remove('on'); },
    };
  `,
})

const say = (text) => page.evaluate((t) => window.__film.say(t), text)
const wait = (ms) => page.waitForTimeout(ms)

/* ---------------------------------------------------------------- 1. title */
await page.evaluate(() =>
  window.__film.card(`
    <p class="kick">Open Agentic Web Challenge · 2026</p>
    <h2>Saddle &amp; Spoke</h2>
    <p>A bicycle repair shop that publishes its front desk as an agent network — and answers your assistant in your own browser.</p>
  `),
)
await wait(4600)

await page.evaluate(() =>
  window.__film.card(`
    <p class="kick">24 Ashfield Lane · est. 1987</p>
    <h2>A shop that<br>answers your <em>agent</em>.</h2>
    <p>No form. No phone tree. One JSON file, and any assistant can ask it for a price and book a slot.</p>
  `),
)
await wait(3600)
await page.evaluate(() => window.__film.hideCard())
await say('The shop publishes three agents and seven site actions. No server, no key.')
await wait(5200)

/* ------------------------------------------------------------------ 2. ask */
await say('I’ll ask it something a customer would actually ask.')
await wait(2600)
await page.click('#say')
await page.type('#say', 'My rear derailleur skips under load. Can you fix it before Friday?', { delay: 26 })
await wait(700)
await say('Front desk, workshop lead, parts desk — three agents run in this tab.')
await page.press('#say', 'Enter')
await page.waitForSelector('.trace-row')
await wait(1500)
await say('When the workshop lead names a part, the page points at it — that is a site action, not a picture.')
await wait(5200)
await say('The price comes from the shop’s own book. £40.50 labour, plus the parts. Not from the model.')
await wait(6000)

/* ----------------------------------------------------------------- 3. peer */
await page.locator('.card', { hasText: 'Ask the trade counter?' }).waitFor({ timeout: 20000 })
await say('Two lines aren’t on the shelf, so it asks a different origin for stock. I have to allow that.')
await wait(5200)
await say('My phone number stays in this tab. The trade counter gets the shop’s account number, and nothing else.')
await wait(4600)
await page.locator('.card', { hasText: 'Ask the trade counter?' }).locator('button', { hasText: 'Allow once' }).click()
await wait(1400)
await say('Its manifest is fetched, the network name matched exactly, and its two agents run here too.')
await wait(5200)

/* ----------------------------------------------------------------- 4. book */
await page.locator('#chips button', { hasText: /^Book/ }).click()
await page.locator('.card', { hasText: 'Run book_dropoff?' }).waitFor({ timeout: 15000 })
await say('Booking is a write, so the page asks first — destination, arguments, effect.')
await wait(4600)
await page.locator('.card', { hasText: 'Run book_dropoff?' }).locator('button', { hasText: 'Confirm' }).click()
await page.waitForSelector('.receipt')
await wait(900)
await say('A receipt with an outcome: confirmed. Not just “the request returned”.')
await wait(5600)

/* ------------------------------------------------------------ 5. conformance */
await page.click('[data-open="conformance"]')
await wait(1200)
await say('Seven interoperability checks from the specification, run live on this page.')
await page.click('button:has-text("Run all checks")')
await page.waitForFunction(
  () => document.querySelectorAll('.check[data-state="pass"], .check[data-state="fail"]').length === 7,
  { timeout: 90000 },
)
await wait(1200)
await say('All seven pass — including the four runs that must be stopped: an invalid network, a depth overrun, a budget, a denied origin.')
await wait(6200)

/* ---------------------------------------------------------------- 6. close */
await page.click('#panelClose')
await wait(600)
await say('The network is data. The runtime is mine. And the key, if there is one, never leaves this tab.')
await wait(5400)
await page.evaluate(() =>
  window.__film.card(`
    <p class="kick">One JSON · any assistant</p>
    <h2>The visitor’s browser<br>does the work.</h2>
    <p class="mono">hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke</p>
    <p style="margin-top:18px">Saddle &amp; Spoke — 24 Ashfield Lane. MIT licensed. Built for the Open Agentic Web Challenge.</p>
  `),
)
await wait(6200)

await context.close()
await browser.close()

const video = page.video()
const raw = await video.path()
console.log('recorded', raw)
const { copyFileSync } = await import('node:fs')
copyFileSync(raw, outPath)
console.log('saved', outPath)
