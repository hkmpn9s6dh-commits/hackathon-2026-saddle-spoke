import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')
const url = process.argv[2] ?? 'http://localhost:4173/'
const out = process.argv[3] ?? 'proof/shots/now.png'
mkdirSync('proof/shots', { recursive: true })
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.screenshot({ path: out })
console.log('errors:', JSON.stringify(errors, null, 2))
await browser.close()
