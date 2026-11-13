# 00 — Brief

> What this repository was built for, and the constraints it was built under. Written at
> the start of the work, not retro-fitted.

## The competition

- **Open Agentic Web Challenge** — Cognizant Technology Solutions (Cognizant AI Lab), administered on Devpost.
- Site: https://cognizant-agenticweb.devpost.com/ · Rules: https://cognizant-agenticweb.devpost.com/rules
- Submission period: 2026-11-11 20:00 PT → **2027-01-11 08:00 PT** (2027-01-12 00:00 Beijing).
- Judging: 2027-01-11 → 01-18. Winners around 2027-01-19.
- Prizes: $5,000 / $3,000 / $2,000 plus Otari credits.
- Eligibility: individuals, teams, organisations. Excluded: Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, and OFAC-sanctioned countries. Mainland China is not excluded.

## What the judges score

**Stage One is pass/fail**: is this a *conforming open agentic website*? A submission that
fails this never reaches Stage Two.

**Stage Two, four equally weighted criteria**:

1. **Technological Implementation** — how well it is built, and how effectively it uses the specification.
2. **Design** — a complete, coherent product experience, not a technical proof of concept.
3. **Potential Impact** — a credible, specific case for a real problem for a real audience; plus any tools shared with the community.
4. **Quality of the Idea** — a creative, non-obvious use, showing genuine understanding of the problem space.

## Required submission material

- A public URL to a working agentic website containing: a public conforming `.json` describing an agent network; a `runtime` that runs it in the browser; an interface for users or agents; optionally a UI to configure LLM and keys; and a network that can interact with the site, optionally with other agentic sites, or be called by them.
- A text description.
- A demonstration video under **two minutes**, public on YouTube, showing the project running in a browser with the entrant explaining it.
- One or more screenshots.
- Everything in English.

## Constraints we set ourselves

- **Reachable platform.** No dependency on services unreachable from the build machine. Google/Firebase endpoints are unreachable here, which is why this is not a Firebase entry.
- **No server, no key, no account.** A judge must be able to open the URL and use it in one click. If the page needed a key, Stage One would depend on the judge having one.
- **Static hosting only.** GitHub Pages for the site; a CDN origin for the peer, so the cross-origin load is real rather than simulated.
- **Own runtime.** The reference `nsdeploy` runtime exists and could have been vendored. Writing the runtime instead is the only way to make "how effectively does it use the specification" a claim about this project rather than about Cognizant's.
- **Two minutes.** The video is a product film, not a walkthrough of the repository.

## What we chose not to build

- Cross-origin site actions (spec §3.1 calls them an extension; not in the MVP profile).
- A real MCP connection — there is no MCP server in this story, and pretending otherwise would weaken the demo.
- Accounts, payments, persistence beyond `localStorage`. The shop is a static bundle on purpose.
