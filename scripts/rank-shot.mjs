import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.screenshot({ path: 'proof/rank/r1/00-ours-idle.png' })
await page.fill('#say', 'My rear derailleur skips under load. Can you fix it before Friday?')
await page.press('#say', 'Enter')
await page.locator('.card', { hasText: 'Ask the trade counter?' }).locator('button', { hasText: 'Allow once' }).click()
await page.waitForTimeout(1600)
await page.screenshot({ path: 'proof/rank/r1/00-ours-answer.png' })
await browser.close()
