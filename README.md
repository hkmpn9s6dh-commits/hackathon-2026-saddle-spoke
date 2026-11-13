# Saddle & Spoke

**A bicycle repair shop that answers your agent.**

This is a working *open agentic website*: a small shop's page that publishes its front desk as a portable agent network, runs that network in the visitor's browser, and — when the visitor allows it — loads a second site's network to check a part. No application server, no key on the shop's side, no build step on the judge's side. Open the page and ask it something.

- **Live site:** https://hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke/
- **Supplier site (a second origin):** https://hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke/peer/
- **Specification:** [Minimum Viable Specification for a Worldwide Agentic Web, MVP Profile 0.2](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)

---

## Try it in thirty seconds

1. Open the live site.
2. Type: `My rear derailleur skips under load. Can you fix it before Friday?`
3. Watch the right-hand bench. Three agents run, four site actions fire, and the drawing on the wall dims while a brass ring settles on the rear derailleur.
4. When the card asks **“Ask the trade counter?”**, press **Allow once**. That is a different origin: its manifest is fetched, the network name is matched exactly, and its two agents run *in this tab*.
5. Press the **Book …** chip, then **Confirm**. You get a receipt with `outcome: confirmed`. Your phone number and frame number were never arguments — the action read them from the page's private context.

No key is needed. The default inference path is a deterministic planner that runs in the tab; the **Model** panel adds an OpenAI-compatible router if you want a real model, and the same network runs unchanged.

## What is actually here

| Artifact | Where | What it is |
|---|---|---|
| `agent-manifest.json` | site root | The site's index: one network, its front agent, the location of the resolved definition, router metadata, peer policy, the action catalogue. |
| `saddle_and_spoke.network.json` | site root | The resolved, data-only network: `front_desk` → `workshop_lead` (price, bench, drawing) and `parts_desk` (shelf, then the trade counter). |
| `links.json` | site root | Publisher-owned binding from the symbolic peer name to the supplier's network URL. |
| `peer/agent-manifest.json` | second origin | The supplier's own manifest. Exact-name matching only; the runtime never substitutes another network. |
| `peer/bellwether_parts.network.json` | second origin | Two agents, `trade_counter` → `stock_keeper`. Its stock list is data inside the published network. |
| `src/runtime/` | source | The runtime: validation, the agent loop, action dispatch, consent, private-context filtering, budgets, traces. |
| `src/conformance/checks.ts` | source | The profile's seven MVP interoperability checks, as executable tests, surfaced in the page. |

The JavaScript bundle is ~52 kB. There is no framework and no runtime dependency.

## How it uses the specification

The profile has three tenets and a set of cross-cutting rules. Each one has a place in the code:

| Profile requirement | Where it lives |
|---|---|
| **Portable network** — data-only Neuro SAN model, manifest, `links.json`, CORS hosting | `public/*.json`, `src/runtime/validate.ts` |
| **Browser execution** — parse, validate, run, delegate, call site actions | `src/runtime/engine.ts`, `src/shop/actions.ts` |
| **Bounded execution** — depth, agent calls, model turns, peer calls, wall clock | `src/runtime/engine.ts` (`Budgets`) |
| **Accurate outcomes** — a refusal is a refusal; an unknown write is `unknown` and is never retried | `src/runtime/engine.ts` (`callAction`) |
| **Site actions** — name, purpose, JSON Schema, effect, handler; writes confirmed with destination and arguments | `src/shop/actions.ts`, `src/main.ts` (`askConsent`) |
| **Peer protocol** — URL → site base → manifest → exact match → fetch → validate → run locally | `src/runtime/peers.ts` |
| **Consent before contact** — origin, purpose, and what stays behind | `src/main.ts` (`askConsent`) |
| **Private context by exception** — deny by default, named fields per destination | `src/runtime/engine.ts` (`filterSly`) |
| **Pluggable inference** — default path plus BYOK, key never leaves the tab | `src/runtime/planner.ts`, `src/runtime/byok.ts` |
| **Observable execution** — router, origins, calls, consent decisions, receipts | `src/main.ts` (the bench, the status bar, the Session panel) |

### The seven interoperability checks, runnable

The **Conformance** button in the page header runs the profile's §6 checks against the live site and prints the evidence. Nothing in that panel is a claim: each row executes the runtime.

1. Publish a two-agent network and a manifest from an ordinary host.
2. Run it with the site's default inference.
3. Call an internal agent and a registered site action.
4. Load an exact named network from a second origin, after approval.
5. Show that a visitor key never reaches the peer.
6. Show that private context is absent at the peer unless a field is named.
7. Stop an invalid network, a depth overrun, an over-budget request and a denied origin — and show each stop.

## Privacy model

The page holds three private fields: the visitor's `contact`, the `bike_serial`, and the shop's `trade_account`. They are never in a prompt, a trace row, or an action argument:

- The **model never sees them.** `book_dropoff` takes `slot` and `part` only; the phone number and frame number are read from private context inside the action, on the page that owns them.
- **Across the boundary, deny by default.** Only `trade_account` is named for `bellwether_parts`. The runtime prints what it sent and what it withheld (`sent: trade_account · withheld: contact, bike_serial`).
- **The key stays in the tab.** It is stored in this origin's `localStorage`, attached only to the router the visitor chose, and never placed in a URL, a manifest, a prompt, an argument or a peer request. Check 5 probes for exactly that.

## Run it yourself

```bash
git clone https://github.com/hkmpn9s6dh-commits/hackathon-2026-saddle-spoke
cd hackathon-2026-saddle-spoke
bash scripts/verify.sh
```

`verify.sh` installs, typechecks, runs 28 unit tests, builds, serves, and then runs 21 end-to-end assertions plus a layout measurement at three viewports. It needs Node 20+ and a Chromium for Playwright (`npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM` to an existing binary).

```bash
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

On localhost the peer is served from `/peer/` so the site runs offline; in production `src/config.ts` points the peer at the CDN origin, which is what makes the load genuinely cross-origin.

## What is deliberately not here

- No server, no accounts, no payments. The shop is a static bundle on purpose: that is the claim.
- Cross-origin *site actions* are outside the MVP profile and are not attempted.
- No MCP connection. `agent-mcp.json` says `available: false` and why; the runtime still parses MCP descriptors and fails closed on ones it cannot reach.
- The default planner is not a language model, and the page says so. It is a deterministic policy over the published graph, which is what lets a visitor — or a judge — use the shop with no key at all.

## License

MIT. See `LICENSE`.

---

Built for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/) (Cognizant AI Lab × Devpost), November 2026.
