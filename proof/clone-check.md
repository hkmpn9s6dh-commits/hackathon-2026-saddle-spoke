# Gate C — fresh clone

> Run on 2026-11-13 at 15:52 Beijing, from a directory that had never seen this project.

```
git clone https://github.com/hkmpn9s6dh-commits/hackathon-2026-saddle-spoke.git
cd hackathon-2026-saddle-spoke
PORT=4199 bash scripts/verify.sh
```

## Output (trimmed to the evidence)

```
== 1/6 install
== 2/6 typecheck
== 3/6 unit tests          Test Files  2 passed (2)   Tests  28 passed (28)
== 4/6 build               dist/assets/index-*.css 18.18 kB │ gzip 4.58 kB
                           dist/assets/index-*.js  51.84 kB │ gzip 18.25 kB
                           ✓ built in 421ms
== 5/6 serve
== 6/6 end-to-end + layout 21/21 checks passed
                           layout: 0 problems at 1440x900, 1180x820, 390x844
== all green
```

Nothing was installed globally, no key was set, and no service outside npm and a local
Chromium was contacted. `npm ci` resolved from `package-lock.json`; the four woff2 subsets
and the drawing are in the repository, so the run is offline after install.

## What the 21 assertions cover

| Group | Assertions |
|---|---|
| AC-1 published artifacts | 5 files reachable (manifest, network, links, peer manifest, peer network) |
| AC-3 default inference, no key | trace shows the delegation and `website_highlight_part`; the drawing marks the part; the job card carries a price |
| AC-4 second origin | consent names the origin and the withheld fields; the peer loads and answers; the runtime prints what it sent |
| AC-5 writes | no ticket before confirming; receipt with `outcome: confirmed`; the ticket exists after |
| AC-6 conformance | all seven checks pass, including the four that must stop |
| AC-7 no key, no third-party traffic | every request is same-origin or one of the two peer fetches |
| AC-8 persistence | the job card survives a reload; a stored key can be cleared |
| console | no errors |
