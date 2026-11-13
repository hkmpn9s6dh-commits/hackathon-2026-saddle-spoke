# Gate D — blind ranking, round 1

> 2026-11-13. This competition has no previous edition (the profile was published on
> 2026-11-06), so the ruler is the one docs/07-UI.md §2 sets: five award-winning product
> sites used as the design standard, not as competitors.

## Set

| Letter | Work | Source |
|---|---|---|
| A | Family (family.co) | ruler |
| B | Teenage Engineering | ruler |
| C | **Saddle & Spoke (this entry)** | main screen, after a repair question |
| D | Vercel | ruler |
| E | Stripe | ruler |
| F | Raycast | ruler |

Lettering was shuffled once with a fixed seed (`map.json`), 1440×900 each, no labels, no
context given to either judge. Judges are two independent contexts that did not take part
in building the entry. They are the same model family; that limitation is recorded rather
than hidden.

## Result

| Judge | Order (strongest first) | This entry | Rulers below it |
|---|---|---|---|
| 1 | **C**, A, F, B, D, E | 1st | 5 |
| 2 | B, F, **C**, D, A, E | 3rd | 3 |

Pass condition: every judge places the entry above at least three rulers.
**Judge 1: 5. Judge 2: 3. Pass.**

## What the judges said

Judge 1, on the entry:

> The drafting-grid ground, wireframe bicycle and monospace "bench" panel turn an abstract
> idea into a legible diagram, with the serif headline holding the top-left corner so
> density never turns into noise — the most bespoke and confident page of the six.

Judge 2, on the entry:

> Best: the blueprint line-drawing of the bike over graph paper, with "REAR DERAILLEUR"
> callouts and a job card, makes a repair shop's front desk feel like a technical
> specification rather than a marketing page. Worst: it is lopsided, because the heavy
> black agent console takes a third of the page and pulls the eye away from the pale sheet,
> leaving the headline and body copy crammed into a narrow strip with small type.

The second criticism is accepted and carried into `docs/07-UI.md` §5.1 as the first thing to
change in the next entry. It was not fixed here: the gate was passed, and re-opening a
passed gate to chase a marginal gain is how a submission slips.

## Note on the weakest ruler

Judge 1's last place (E, Stripe) is a screenshot where cookie and region banners had opened
over the hero. That is an artefact of capturing a live site, not a judgement of Stripe's
design. It did not change the outcome: the entry was above three or more rulers for both
judges regardless of where E landed.
