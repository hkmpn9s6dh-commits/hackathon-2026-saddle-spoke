#!/usr/bin/env node
/**
 * The gallery cover is a crop of the product itself: the wall, the ring on the part,
 * the job card filled in. Nothing is redrawn, so the cover cannot drift from the page.
 */
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe')
const url = process.env.SITE_URL ?? 'http://localhost:4173/'
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle' })
mkdirSync('submission', { recursive: true })
await page.screenshot({ path: 'submission/cover-1500x1000.png' })
await browser.close()
console.log('cover written')
