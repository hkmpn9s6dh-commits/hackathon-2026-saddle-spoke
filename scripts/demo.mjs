#!/usr/bin/env node
/**
 * Records the demonstration film, cut to its narration.
 *
 * The voice track is synthesised first (`scripts/narrate.py`), so every line has a known
 * length. The recorder holds each beat for exactly that long and writes the timeline it
 * used to `video/timeline.json`. `scripts/mux.py` lays the same clips at the same offsets
 * over the picture, so sound and picture cannot drift: both are built from one set of
 * numbers.
 *
 * Every frame is the real product. Captions and three cards are the only additions, and
 * they are injected into the page so the recording needs no compositing.
 *
 *   python scripts/narrate.py
 *   node scripts/demo.mjs [--url …]
 */
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : fallback
}
const url = arg('--url', 'http://localhost:4173/')
const outPath = arg('--out', 'video/saddle-and-spoke-demo.webm')
const exe =
  process.env.PLAYWRIGHT_CHROMIUM ??
  join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')

const LEAD = 0.45 // silence before a line
const PAD = 0.8 // hold after a line

const narration = JSON.parse(readFileSync('video/narration.json', 'utf8'))
const byId = Object.fromEntries(narration.map((n) => [n.id, n]))

/** The beats of the film. `at` is when the action fires, in seconds after the line starts. */
const beats = [
  { id: 'intro', caption: false, card: 'title' },
  { id: 'publish', caption: false, card: 'tagline' },
  { id: 'reveal', from: 'card' },
  { id: 'ask' },
  { id: 'agents' },
  { id: 'point' },
  { id: 'price' },
  { id: 'peer' },
  { id: 'trust', at: 2.4, act: 'allow' },
  { id: 'book', at: 0.8, act: 'bookchip' },
  { id: 'receipt', at: 0.8, act: 'confirm', pad: 1.2 },
  { id: 'conf', at: 1.0, act: 'openconf' },
  { id: 'stop', at: 0.3, act: 'runchecks', pad: 2.4 },
  { id: 'close', at: 1.2, act: 'closeconf' },
  { id: 'end', caption: false, card: 'end' },
]

let cursor = 0
const timeline = beats.map((beat) => {
  const voice = byId[beat.id]
  if (!voice) throw new Error(`no narration for "${beat.id}" — run python scripts/narrate.py`)
  const start = cursor
  const hold = LEAD + voice.seconds + (beat.pad ?? PAD)
  cursor += hold
  return { ...beat, start: Number(start.toFixed(3)), hold: Number(hold.toFixed(3)), voice: voice.file, seconds: voice.seconds }
})

rmSync('video/raw', { recursive: true, force: true })
mkdirSync('video/raw', { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: 'video/raw', size: { width: 1440, height: 900 } },
})

const recordStart = Date.now()
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(250)

await page.addStyleTag({
  content: `
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
      color: #f0eade; opacity: 0; transition: opacity .24s ease;
      pointer-events: none;
    }
    .film-caption.on { opacity: 1; }
    .film-card {
      position: fixed; inset: 0; z-index: 9500; display: none;
      place-items: center; background: #f3eee4; color: #17140f;
    }
    .film-card.on { display: grid; }
    .film-card .inner { width: min(920px, 78vw); padding: 0 8px; }
    .film-card .kick {
      font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: .18em;
      text-transform: uppercase; color: #6d6353; margin: 0 0 22px;
    }
    .film-card h2 {
      font-family: 'Fraunces', Georgia, serif; font-weight: 600; letter-spacing: -0.03em;
      font-size: 78px; line-height: 1.0; margin: 0 0 22px;
    }
    .film-card h2 em { font-style: italic; color: #a8621f; }
    .film-card p { font-size: 18px; line-height: 1.5; color: #3b352b; margin: 0; max-width: 44ch; }
    .film-card.dark { background: #100e0b; color: #e8e2d6; }
    .film-card.dark .kick { color: #8a8272; }
    .film-card.dark h2 { color: #f3eee4; font-size: 58px; }
    .film-card.dark p { color: #a89e8b; }
    .film-card .mono { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #a8621f; letter-spacing: .02em; display: inline-block; white-space: nowrap; background: transparent; padding: 0; border: 0; }
    .film-card.dark .mono { color: #d9a05a; }
  `,
})

await page.addScriptTag({
  content: `
    const cap = document.createElement('div');
    cap.className = 'film-caption';
    document.body.appendChild(cap);
    window.__film = {
      say(text) { cap.textContent = text; cap.classList.add('on'); },
      mute() { cap.classList.remove('on'); },
      card(kind) {
        let el = document.querySelector('.film-card');
        if (!el) { el = document.createElement('div'); el.className = 'film-card'; document.body.appendChild(el); }
        el.className = 'film-card on' + (kind === 'end' ? ' dark' : '');
        if (kind === 'title') {
          el.innerHTML = '<div class="inner"><p class="kick">Open Agentic Web Challenge · 2026</p>' +
            '<h2>Saddle &amp; Spoke</h2>' +
            '<p>A bicycle repair shop that publishes its front desk as an agent network — and answers your assistant in your own browser.</p></div>';
        } else if (kind === 'tagline') {
          el.innerHTML = '<div class="inner"><p class="kick">24 Ashfield Lane · est. 1987</p>' +
            '<h2>A shop that<br>answers your <em>agent</em>.</h2>' +
            '<p>No form. No phone tree. One JSON file, and any assistant can ask it for a price and book a slot.</p></div>';
        } else {
          el.innerHTML = '<div class="inner"><p class="kick">One JSON · any assistant</p>' +
            '<h2>The visitor’s browser<br>does the work.</h2>' +
            '<p class="mono">hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke</p>' +
            '<p style="margin-top:18px">Saddle &amp; Spoke — 24 Ashfield Lane. MIT licensed. Built for the Open Agentic Web Challenge.</p></div>';
        }
      },
      hideCard() { document.querySelector('.film-card')?.classList.remove('on'); },
    };
  `,
})

const t0 = Date.now()
const preRoll = t0 - recordStart

const at = async (seconds) => {
  const wait = t0 + seconds * 1000 - Date.now()
  if (wait > 0) await page.waitForTimeout(wait)
}
const say = (text) => page.evaluate((t) => window.__film.say(t), text)
const mute = () => page.evaluate(() => window.__film.mute())
const showCard = (kind) => page.evaluate((k) => window.__film.card(k), kind)
const hideCard = () => page.evaluate(() => window.__film.hideCard())

for (const beat of timeline) {
  const start = beat.start

  if (beat.from === 'card') await hideCard()
  if (beat.card) await showCard(beat.card)

  if (beat.caption === false) {
    await mute()
  } else {
    await at(start + LEAD)
    await say(byId[beat.id].text)
  }

  if (beat.id === 'ask') {
    await at(start + LEAD + 1.4)
    await page.click('#say')
    await page.type('#say', 'My rear derailleur skips under load. Can you fix it before Friday?', { delay: 24 })
    await at(start + LEAD + 3.1)
    await page.press('#say', 'Enter')
  }
  if (beat.id === 'agents') await page.waitForSelector('.trace-row', { timeout: 15000 })
  if (beat.act === 'allow') {
    await at(start + LEAD + beat.at)
    await page.locator('.card', { hasText: 'Ask the trade counter?' }).locator('button', { hasText: 'Allow once' }).click()
  }
  if (beat.act === 'bookchip') {
    await at(start + LEAD + beat.at)
    await page.locator('#chips button', { hasText: /^Book/ }).click()
  }
  if (beat.act === 'confirm') {
    await at(start + LEAD + beat.at)
    await page.locator('.card', { hasText: 'Run book_dropoff?' }).locator('button', { hasText: 'Confirm' }).click()
    await page.waitForSelector('.receipt', { timeout: 15000 })
  }
  if (beat.act === 'openconf') {
    await at(start + LEAD + beat.at)
    await page.click('[data-open="conformance"]')
  }
  if (beat.act === 'runchecks') {
    await at(start + LEAD + beat.at)
    await page.click('button:has-text("Run all checks")')
    await page.waitForFunction(
      () => document.querySelectorAll('.check[data-state="pass"], .check[data-state="fail"]').length === 7,
      { timeout: 90000 },
    )
  }
  if (beat.act === 'closeconf') {
    await at(start + LEAD + beat.at)
    await page.click('#panelClose')
  }

  await at(start + beat.hold)
}

writeFileSync(
  'video/timeline.json',
  JSON.stringify({ preRollMs: preRoll, totalSeconds: Number(cursor.toFixed(3)), beats: timeline }, null, 2),
)
console.log(`timeline: ${cursor.toFixed(1)}s, ${timeline.length} beats, pre-roll ${preRoll}ms`)

await context.close()
await browser.close()

const raw = await page.video().path()
copyFileSync(raw, outPath)
console.log('recorded', outPath)
