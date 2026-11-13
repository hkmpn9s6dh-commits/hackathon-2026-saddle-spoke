import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')
const targets = [
  ['02-vercel', 'https://vercel.com'],
  ['06-arena', 'https://www.are.na'],
]
const browser = await chromium.launch({ executablePath: exe })
for (const [name, url] of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(7000)
    await page.screenshot({ path: `proof/rank/r1/${name}.png` })
    console.log('ok', name)
  } catch (e) { console.log('fail', name, e.message) }
  await page.close()
}
await browser.close()
