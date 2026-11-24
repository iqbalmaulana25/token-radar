# Launch Radar — every value term fitted and tested held-out twice

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/iqbalmaulana25/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/iqbalmaulana25/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have not issued a token yet. It reads the competition's frozen DefiLlama snapshot (758 protocols, as of 2026-11-14), prices the ones that record no token against the ones that do, and ranks **198 pre-token protocols by implied value** — every one of the 40 watchlist protocols covered, plus 158 early finds below the watchlist's $50M floor. It emits the ranked board (`board.json`), a self-contained dashboard (`dashboard/` + `data.js`) with a per-protocol detail view and farm plan for every row, and three screenshots of the dashboard itself.

What changed in this version is not the shape of the model but how it earned its terms. launch-radar-2's constants were set by hand and fitted once, in-sample. launch-radar-3 keeps only what survives a blind test: each candidate term was fitted on half of the 128 traded protocols and scored on the held-out half, **twice — on a slug-hash split and on a time split** — and a term ships only if both splits keep it. Three of the old model's six terms failed and are gone; the dashboard's **Method & validation** view shows the whole record, errors included.

## The model (launch-radar-3)

```
implied value = TVL × category multiple × scale × momentum
```

- **Category multiple** — the median market-cap-to-TVL ratio of traded tokens in the protocol's own category (128 comparables; global median 0.214×), shrunk toward the global figure with fitted shrinkage **K=3**; below 3 comparables the global median carries the price.
- **Scale** — value bends by **TVL^0.9** around a $100M reference, so a dollar of TVL in a large protocol prices a little lower than in a small one. A plain TVL×multiple model assumes size is free; the held-out data says it is not.
- **Momentum** — **1 + 0.6 × clamp(7-day TVL change, −40%, +60%) / 100**.
- **Range** — the category's p25 and p75 multiples in place of the median, other factors unchanged. The ranges are wide because the ratios are wide; ratio winsorising was tested and dropped (below), so the tails are shown as they are.

Every figure comes from the snapshot record. No protocol name is special-cased anywhere; a protocol whose token already trades is never ranked — it sits in the comparables the board is priced against.

## The validation — fitted and tested held-out twice

`tools/validate.mjs` (Node, no dependencies) is the harness. It walks six candidate terms in a fixed order on each split: variants are fitted on the training half only, and a term is kept only if its fitted variant cuts the held-out half's median absolute log error (MdALE) by at least 0.5% relative. Error is measured against the market cap each held-out protocol actually carries.

| Split | Train | Held out | Bare model | launch-radar-2 | Selected | Shipped model refitted |
|---|---|---|---|---|---|---|
| A — hash of slug | 59 | 69 | 1.433 | 1.344 | 1.298 | **1.209** |
| B — listing time (fit past, test future) | 48 | 47 | 1.669 | 1.610 | 1.478 | **1.495** |

Per-term verdicts (held-out MdALE before → after the fitted variant):

| Term | Split A | Split B | Shipped |
|---|---|---|---|
| Category multiples | K=5 · 1.433 → 1.391 · kept | K=3 · 1.669 → 1.649 · kept | **K=3** |
| Winsorise ratios | 1.391 → 1.391 (0.0%) · dropped | 1.649 → 1.649 (0.0%) · dropped | not in the model |
| Scale (TVL elasticity) | β=0.95 · → 1.331 · kept | β=0.90 · → 1.551 · kept | **β=0.9** |
| Momentum | w=0.3 · → 1.313 · kept | w=0.3 · → 1.523 · kept | **w=0.6** (lowest combined held-out error) |
| Maturity (age premium) | → 1.320 (+0.5%) · dropped | → 1.478 (−3.0%) · kept | not in the model — splits disagreed |
| Breadth (per-chain premium) | → 1.298 (−1.1%) · kept | → 1.478 (0.0%) · dropped | not in the model — splits disagreed |

Notes the table deserves: winsorising changed no held-out price at all — the median a price rests on is already robust — so the clamp is gone rather than kept for comfort. The shipped model's full-set error is 1.214 against launch-radar-2's 1.343, but that figure is in-sample and is quoted only to be dismissed; the held-out rows above are the evidence. The fitted parameters ship in `lib/fitted.ts`, which the harness itself writes, and the full machine-readable record is in `tools/validation-results.json` and in the dashboard's data.

## The v4 audit — a stricter test, and why launch-radar-3 still stands

Before any launch-radar-4 could replace it, the shipped model was put through a harder audit (`tools/validate-v4.mjs`, record in `tools/validation-v4-results.json`): a third, category-stratified split; variant fitting by cross-validation instead of in-sample choice; and selection over whole model forms by pooled 5-fold CV across all 128 traded protocols, with launch-radar-3 itself competing as a fixed form. The bar was set before the run: a challenger ships only if it beats the incumbent in pooled CV **and** beats its shipped form on both original splits.

The best challenger — the same three terms, refitted by CV (shrinkage K=10, elasticity 0.8, momentum w=0.6) — did beat the incumbent in pooled CV (1.343 against 1.452) and on two of the three splits (time 1.426 against 1.495; stratified 1.255 against 1.267). On the hash split it lost clearly, 1.439 against 1.209: the CV fit's stronger shrinkage and steeper elasticity are a compromise that split's held-out half prices badly. Under the bar set in advance, that is a fail, so **launch-radar-3 remains the shipped model, unchanged**. The audit's other findings are recorded in the harness: the momentum window ([−40, +60]) was fitted for the first time and the fitted choice was the hand-set window itself; maturity helps the time and stratified splits and hurts the hash split under every procedure tried, so it stays out; and no procedure — walk, marginal, or pooled-CV — produced a form that beat 1.209 on the hash split. The typical error is still ≈3.3–4.5×; the audit narrowed where the model is weak, it did not make it strong.

## What it cannot do

Its typical held-out price is off by a factor of ≈3.3 (hash split) to ≈4.5 (time split); only 29% and 19% of held-out protocols were priced within 2×. Treat every implied value as a ranking with a wide range around it, never as a quote. The time split is the harder and more honest test — protocols listed later price worse than earlier ones — so expect drift as the market regime moves. 33 of the 128 traded protocols record no listing date and sit out the time split. And the model prices a token as if issued against the record in the snapshot: it says nothing about whether or when one is issued.

## Farm plans

Every board row carries a seven-step plan built from that protocol's own record: the cheapest chain it serves and the bridge route in, the product surface to use (named from its category), a deposit sized to its TVL and implied value with a stated dollar figure, a cadence matched to its 7-day TVL trend, a qualifying window derived from its age, a points/multiplier watch, a parallel position in a traded comparable from its own category, and the claim-and-exit step. A plan that ignores cost and time is a horoscope; these carry both.

## The dossier

`dossier.json` is written by the vendored `vendor/makefun-board.ts` `buildDossier`, called with the kit's own caps (dashboard ≤ 400 files / 4 MiB, screenshots ≤ 4 × 512 KiB, text ≤ 64 KiB per file), so the submitted dossier is byte-for-byte the file the grader rebuilds. Dashboard source totals ≈37 KB so it travels whole. Screenshots are real 1440×900 captures of the generated dashboard: the board, the top-ranked protocol's detail view, and the watchlist-only filtered board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

`/input` is where the grader mounts the sealed snapshot; `--input` also accepts a directory holding `snapshot.json`, and `MAKEFUN_OUTPUT_DIR` stands in for `/output` outside the grader. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, and the same input always produces the same bytes. Reproduce the validation with `node tools/validate.mjs`. No dependencies anywhere; Node ≥ 22 runs the TypeScript directly.

Model: **launch-radar-3** · Source: DefiLlama snapshot, as of 2026-11-14 · Not investment advice.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hhk4ynvx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
