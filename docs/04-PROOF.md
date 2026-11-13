# 04 — Proof

> Gate C: can you prove it works? Every line below was produced by a command in this
> repository, on 2026-11-13, against the deployed site and against a fresh clone.

## The two commands

```bash
bash scripts/verify.sh                 # fresh clone → install, typecheck, unit, build, serve, e2e, layout
SITE_URL=https://hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke/ node scripts/e2e.mjs
```

## Local run (`scripts/verify.sh`)

| Step | Result |
|---|---|
| `npm ci` | clean install |
| `tsc --noEmit` | no errors |
| `vitest run` | **28 tests, 2 files, all pass** |
| `vite build` | `dist/` 52 kB JS, 16 kB CSS, 4 woff2 subsets |
| `scripts/e2e.mjs` (against `vite preview`) | **21 / 21 assertions pass** |
| `scripts/measure.mjs` | **0 layout problems** at 1440×900, 1180×820, 390×844 |

A **fresh clone** (a directory that had never seen the project) ran the same script on
2026-11-13 at 15:52 and ended in `== all green`; the transcript is `proof/clone-check.md`.

Unit tests cover: manifest and network validation (duplicates, missing front man, dangling
references, reserved prefix), argument validation (enum, required, additionalProperties,
date format, bounds), depth and call budgets, refusal vs unknown outcomes, "a write is
never retried after an unknown outcome", consent denial, private-context filtering,
the shop's own pricing arithmetic, and the default planner running a whole network with
no key.

## Deployed run (real cross-origin peer)

Same suite against `https://hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke/`:
**21 / 21 pass**, including:

- `AC-4 peer loaded and answered` — the consent card names `https://cdn.jsdelivr.net`, and after
  **Allow once** the supplier's manifest and network are fetched from that origin, matched by
  exact name, and run in the page's own runtime.
- `AC-4 sly accounting` — the trace prints `sent: trade_account · withheld: contact, bike_serial`.
- `AC-6 all seven conformance checks pass` — 7/7, run inside the live page.
- `AC-7 no third-party requests without a key` — with the default planner, the only requests
  are same-origin plus the two peer fetches.

## The seven interoperability checks (run in the page)

Open **Conformance** in the header, press **Run all checks**. Each row executes the runtime
and prints what it observed. On the deployed site:

| # | Check | Observed |
|---|---|---|
| 1 | Publish a network and a manifest from an ordinary host | 3 agents, manifest valid |
| 2 | Run with the site's default inference | 2 agents ran, answer returned |
| 3 | Call an internal agent and a registered site action | delegation yes; `website_get_shop_state`, `website_highlight_part`, `website_quote_repair`, `website_check_dropoff_slots` |
| 4 | Load an exact named network from a second origin | `https://cdn.jsdelivr.net` · ok |
| 5 | A visitor key never reaches the peer | 2 requests to the peer origin, none carried the probe key |
| 6 | Private context absent at the peer unless named | `sent: trade_account · withheld: contact, bike_serial` |
| 7 | Stop invalid / over-budget / denied origin / refused consent | invalid stopped · depth stopped · budget stopped · denied origin stopped · consent refused stopped |

## Screenshots

| File | What it shows |
|---|---|
| `proof/shots/e2e-1-quote.png` | the quote, the lit part, the trace |
| `proof/shots/e2e-2-peer.png` | the peer answer and the private-context accounting |
| `proof/shots/e2e-3-receipt.png` | the receipt with `outcome: confirmed` |
| `proof/shots/e2e-4-conformance.png` | 7/7 conformance |
| `proof/shots/layout-*.png` | the three measured viewports |
| `submission/cover-1500x1000.png` | the gallery cover |
| `submission/saddle-and-spoke-demo.mp4` | the film: 107.8 s, English narration, −16 LUFS, peak −2 dBTP |

The film is rebuilt from three inputs by one command (`npm run film`): the script
(`video/lines.json`), the recorded picture (`scripts/demo.mjs`) and the mix (`scripts/mux.py`).
Picture and voice are laid out from the same `timeline.json`, so they cannot drift; how that
works, and the three ways narration failed first, are written up in `docs/08-VOICE.md`.

## What is not proven here

- **A real LLM path.** The BYOK path is implemented and unit-reachable, but the judge-facing
  demo runs on the default planner. A live model would add latency and a key requirement to
  the one thing that must never break: Stage One.
- **The narration is a neural TTS voice, not a person.** It is clear and it is timed to the
  picture, but it is not a human reading.
- **MCP.** No MCP server is contacted; `agent-mcp.json` says so.
- **Other browsers.** Verified in Chromium only. The code avoids non-standard APIs, but that
  is an argument, not evidence.
