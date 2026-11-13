#!/usr/bin/env node
/**
 * Layout hygiene at the baseline viewport: no page scroll, no overlapping paper,
 * no unreadably small body text. It judges hygiene only, never taste.
 */
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'

const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')
const url = process.env.SITE_URL ?? 'http://localhost:4173/'
const problems = []

const browser = await chromium.launch({ executablePath: exe })
for (const viewport of [
  { width: 1440, height: 900, name: '1440x900' },
  { width: 1180, height: 820, name: '1180x820' },
  { width: 390, height: 844, name: '390x844' },
]) {
  const page = await browser.newPage({ viewport })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
  const report = await page.evaluate(() => {
    const out = { scrollX: 0, scrollY: 0, small: [], overlap: [] }
    out.scrollX = document.documentElement.scrollWidth - window.innerWidth
    out.scrollY = document.documentElement.scrollHeight - window.innerHeight
    for (const el of document.querySelectorAll('p, li, dd, .msg-text, .card .note')) {
      const cs = getComputedStyle(el)
      const size = parseFloat(cs.fontSize)
      // Monospace labels are meant to be small; body text is not.
      if (cs.fontFamily.toLowerCase().includes('plex')) continue
      if (size < 12.5 && el.textContent.trim()) out.small.push(`${el.className || el.tagName}:${size}px`)
    }
    const rect = (s) => {
      const e = document.querySelector(s)
      return e ? e.getBoundingClientRect() : null
    }
    const hits = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
    const pairs = [
      ['.jobcard', '.pricecard'],
      ['.callout', '.pricecard'],
      ['.callout', '.jobcard'],
    ]
    for (const [a, b] of pairs) if (hits(rect(a), rect(b))) out.overlap.push(`${a} × ${b}`)
    return out
  })
  if (report.scrollX > 0) problems.push(`${viewport.name}: horizontal scroll ${report.scrollX}px`)
  if (report.scrollY > 0 && viewport.width > 1024) problems.push(`${viewport.name}: vertical scroll ${report.scrollY}px`)
  if (report.overlap.length) problems.push(`${viewport.name}: overlap ${report.overlap.join(', ')}`)
  if (report.small.length) problems.push(`${viewport.name}: small text ${[...new Set(report.small)].join(', ')}`)
  await page.screenshot({ path: `proof/shots/layout-${viewport.name}.png` })
  await page.close()
}
await browser.close()

if (problems.length) {
  console.log('layout problems:')
  problems.forEach((p) => console.log(' - ' + p))
  process.exit(1)
}
console.log('layout: 0 problems at 1440x900, 1180x820, 390x844')
