#!/usr/bin/env node
/**
 * Captures the ruler: award-winning product sites used as the design standard in
 * docs/07-UI.md §2. These are the works the entry is ranked against, because this
 * competition has no previous edition to draw winners from.
 */
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')
const targets = [
  ['01-stripe', 'https://stripe.com'],
  ['02-linear', 'https://linear.app'],
  ['03-raycast', 'https://www.raycast.com'],
  ['04-family', 'https://family.co'],
  ['05-teenage', 'https://teenage.engineering'],
  ['06-notion-calendar', 'https://calendar.notion.so'],
]
const browser = await chromium.launch({ executablePath: exe })
for (const [name, url] of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(9000)
    await page.screenshot({ path: `proof/rank/r1/${name}.png` })
    console.log('ok', name)
  } catch (err) {
    console.log('fail', name, err.message)
  }
  await page.close()
}
await browser.close()
