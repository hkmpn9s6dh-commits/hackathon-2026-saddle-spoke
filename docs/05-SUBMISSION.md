# 05 — Submission copy (Devpost)

> Everything below is written to be pasted into the Devpost form. Character counts are
> noted where the field has a limit.

## Project name

Saddle & Spoke

## Elevator pitch (≤ 200 characters)

A bicycle repair shop that publishes its front desk as an agent network. Any assistant can ask it for a real price and book a real slot — in the visitor's browser, with your phone number never leaving the tab.

## Inspiration

The agentic web will not begin with banks. It will begin with the shop at the end of the road: the repair place, the dentist, the guesthouse with four rooms. Those businesses will never have an API team, and they should not need one.

The specification published by Cognizant AI Lab in November describes exactly that possibility — a site publishes its agents as *data*, and any browser can run them. What it did not have was a page that shows what that feels like from the outside. So we built one, for a shop we would actually visit: Saddle & Spoke, 24 Ashfield Lane, repairs and wheelbuilding since 1987.

## What it does

You ask the page a normal question: *"My rear derailleur skips under load. Can you fix it before Friday?"*

- The **front desk agent** reads the shop — the queue, the price list, today's date — and hands the repair to the **workshop lead**.
- The workshop lead calls `highlight_part`. **The bicycle drawing on the wall dims, and a brass ring settles on the rear derailleur** with its part number beside it. The agent does not describe the part; it points at it.
- It prices the job from the shop's own book: £40.50 labour plus a derailleur, a hanger and a cable. £86.50.
- Two of those lines are not on the shelf, so the **parts desk** asks the trade counter. That is a different origin, and the page stops and asks: *"Ask the trade counter? cdn.jsdelivr.net — your contact details will not be sent."*
- You allow it. The supplier's `agent-manifest.json` is fetched, its network name matched exactly, and its two agents run **in your tab**, with the shop's runtime. It answers: six on the shelf, two days, £18.40 trade.
- You pick Thursday 17:30. Booking is a write, so you get a confirmation card with the destination and the arguments, then a receipt: `SS-4F2A · outcome: confirmed`.

Two things are worth noticing. The phone number and frame number on the job card **were never arguments** — the model never saw them; the action read them from the page's private context. And across the boundary, the runtime prints what it sent and what it withheld: `sent: trade_account · withheld: contact, bike_serial`.

## How we built it

A static TypeScript bundle, 52 kB, no framework, no server, no key on the shop's side.

- **The runtime is ours** (`src/runtime/`). It parses a manifest, resolves a network by exact name, validates it before any model call, runs the agent loop with delegation, and exposes a page's own operations to the model as site actions with JSON Schemas and effect classes. We deliberately did not vendor the reference `nsdeploy` bundle: "uses the specification well" should be a claim about this project.
- **The edges are where the work is.** Composition depth, agent-call budgets, model turns, peer budgets and a wall clock — all enforced. A refusal is reported as a refusal. A write that throws is reported as an **unknown outcome**, and the runtime refuses to repeat it.
- **Two inference paths, one graph.** The default is a deterministic planner that runs in the tab: no key, no network, so a judge can use the shop in one click. The *Model* panel adds an OpenAI-compatible router (BYOK) and the network runs unchanged — which is what "pluggable inference" is supposed to mean.
- **A conformance panel you can press.** The profile's seven MVP interoperability checks are executable and live in the page. Each row runs the runtime and prints what it saw, including the four runs that must fail: an invalid network, a depth overrun, an over-budget request, a denied origin.
- **The shop is real.** Queue, price list, stock, slots and job cards are one small data model shared by the page and the actions, so the agent and the visitor can never get different answers. Bookings survive a reload.

## Challenges

**Making privacy visible instead of asserted.** It is easy to say "your data stays in the browser". We wanted the page to prove it, so the phone number is not an argument the model could repeat, and the runtime prints the fields it withheld. The consent card is the only place a user learns what is about to leave — so it had to be readable, not a wall of JSON.

**A cross-origin load that is genuinely cross-origin.** On localhost the peer is served from the same origin, which would have made the demo a lie. In production the supplier's bundle is served from a CDN origin, so the manifest fetch, the CORS headers and the exact-name match are all real. The e2e suite runs against the deployed URL, not a local build.

**Two minutes.** The video is a product film. Every claim in it had to be true at the moment of recording, which pushed us to make the default path work without a key at all.

**The specification's hard parts are failure paths.** Most of the code is not the happy path; it is validation, budgets, consent records, and the difference between "the request returned" and "the thing happened".

## Accomplishments we are proud of

- **7/7 conformance checks, run inside the live page** — including the four that must stop.
- **21 end-to-end assertions passing against the deployed site**, in a real browser, with the peer on another origin.
- **28 unit tests** over validation, budgets, result semantics and private-context filtering.
- A page that a non-technical visitor can use, and a `Conformance` button that a technical judge can press.

## What we learned

- **The published network is the contract.** Once the graph is data, the runtime, the model and the funding can all change underneath it. Our shop runs on two different inference paths without touching the network file.
- **Consent is a design problem, not a checkbox.** The moment it became a readable card — origin, purpose, and what stays behind — the demo became understandable.
- **"Unknown" is a first-class outcome.** Modelling it honestly changed the action design: idempotent reads, confirmed writes, and a runtime that would rather stop than guess.
- **The long tail does not need a platform.** A shop needs a JSON file and someone else's runtime.

## What's next

- A second shop on a second domain, to show two *shops* calling each other's agents, not just a shop and a supplier.
- A small publisher tool: paste a price list, get a manifest, a network and a page.
- Model policy declarations (the spec's optional extension): a network saying which model families it has been tested with, and a runtime warning before it runs on something else.

## Built with

typescript, vite, vitest, playwright, html, css, json, neuro-san-hocon, open-agentic-web-spec

## Try it out

- Live site: https://hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke/
- Supplier site (second origin): https://hkmpn9s6dh-commits.github.io/hackathon-2026-saddle-spoke/peer/
- Repository: https://github.com/hkmpn9s6dh-commits/hackathon-2026-saddle-spoke
- Video: `<fill in after upload>`
