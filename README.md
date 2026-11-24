# Launch Radar — a cross-validated GAM prices every launch

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/iqbalmaulana25/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/iqbalmaulana25/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have not issued a token yet. It reads the competition's frozen DefiLlama snapshot (758 protocols, as of 2026-11-14), prices the ones that record no token against the ones that do, and ranks **198 pre-token protocols by implied value** — every one of the 40 watchlist protocols covered, plus 158 early finds below the watchlist's $50M floor. It emits the ranked board (`board.json`), a self-contained dashboard (`dashboard/` + `data.js`) with a per-protocol detail view and farm plan for every row, and three screenshots of the dashboard itself.

What changed in this version is the shape of the model itself. launch-radar-3 (the previous version, whose full record is kept below) priced with three hand-shaped terms that survived a blind test. launch-radar-4 replaces them with a **piecewise multiplicative GAM** whose pieces are learned step functions, chosen by cross-validation in an audit of six model families (the v5 audit, below). On pooled cross-validation and on the time split it is the more accurate model; on the hash split it loses to the model it replaced, and it ships anyway — on the entrant's explicit decision to follow pooled CV over the hash-split bar the earlier rounds had set. That decision, with the table it was made from, is recorded in **The ship decision** below and in the dashboard's **Method & validation** view. Nothing about it is smoothed over.

## The model (launch-radar-4)

```
log(implied value) = log(TVL) + level + category offset + TVL-shape offset
                     + momentum offset + age offset
```

- **Level + category offset** — a constant plus a per-category offset, each a shrunk median of backfitting residuals (shrinkage 3 toward a zero offset); a category with no traded protocols gets a zero offset and the level carries its price.
- **TVL shape** — a free step function of log TVL in **6 quantile bins**, forced **non-increasing** (isotonic): a dollar of TVL in a large protocol prices lower than in a small one, by a curve the data drew instead of one global elasticity.
- **Momentum** — binned offsets on the 7-day TVL change (clamped to −40%…+60%, five fixed bins).
- **Age** — binned offsets on normalised age (log age over a five-year span, four quantile bins); undated protocols take the fit set's median age.
- **Range** — the point price moved by the model's own middle-half band on the traded protocols it was fitted on (the p25–p75 of its fit residuals, ×0.474 to ×2.927). The ranges are wide because the model's errors are wide; they are shown as they are.

The pieces are fitted by three backfitting passes over the 128 traded protocols (`lib/gam.ts`, ported line for line from the audit harness that chose the configuration: 6 bins, isotonic, shrinkage 3, age on). Every figure comes from the snapshot record. No protocol name is special-cased anywhere; a protocol whose token already trades is never ranked — it sits in the comparables the GAM is fitted on.

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

## The v5 audit — different model families, same bar, same answer

The v4 round exhausted the shipped model's own family: every term tweak that gained on one split lost on another. The v5 audit (`tools/validate-v5.mjs`, record in `tools/validation-v5-results.json`) changed the family instead. Six challengers — bagged regression trees, gradient boosting, kernel/k-nearest-neighbour regression in standardised feature space, a piecewise multiplicative GAM whose TVL response is a learned isotonic step function rather than one global elasticity, ridge and median (LAD) linear regression, and a stacked blend of the incumbent with a partner family — were fitted on the same frozen snapshot, from the same five signals, under the v4 protocol unchanged: configurations chosen by inner 5-fold CV, then a shipped-form read on all three splits, with nested-selection and pooled-CV reads alongside. The bar was v4's: beat the shipped form on **both** original splits (hash below 1.209, time below 1.495).

Every challenger beat the incumbent on the time split, most of them heavily (blend 0.979, bagged trees 1.027, kernel 1.069, the GAM 1.133, linear 1.169, boosting 1.491 — against 1.495), and five of the six beat it in pooled cross-validation (kernel 1.216, linear 1.226, blend 1.279, GAM 1.286, bagged trees 1.348 — against 1.452). On the honest generalisation reads, several of these models are simply better than the one shipped. On the hash split, every one of them lost: the GAM came closest at 1.300 against 1.209, and the rest spread from 1.308 to 1.545. No family cleared both splits under any of the three selection procedures — the nested reads, whose configurations never see the split they are scored on, told the same story.

One caveat belongs on the record: launch-radar-3's own constants were chosen in the v3 round by their combined held-out error on these very two splits, so the hash split is partly a home game for the incumbent, and its 1.209 there is flattered in a way no honestly-selected challenger can match. That is a reason to distrust the split as a pure measure of the incumbent — it is not a reason to move a bar after the run that failed to clear it. Under the bar set in advance, **launch-radar-3 remained the shipped model**; the audit's harness is deterministic and its record reproducible, and the shipped outputs were byte-identical to the previous build (dossier sha256 7fd05535…). What the v5 round establishes is narrower and more useful than a new model: the remaining error is not a failure of functional form. Five unrelated families land in the same place — better on the future than the incumbent, worse on the hash split — which points at the snapshot itself (128 traded protocols, a third of them undated) as the binding constraint, not at the shape of the price.

## The ship decision — launch-radar-4 ships the GAM

The v5 audit closed under its own bar with no ship. The entrant then read the audit's table and directed that the GAM ship as launch-radar-4, following pooled cross-validation over the split-A bar. The table the decision was made from (shipped-form held-out MdALE; lower is better):

| Family (chosen configuration) | A — hash | B — time | C — stratified | Pooled CV |
|---|---|---|---|---|
| launch-radar-3 (incumbent) | **1.209** | 1.495 | 1.267 | 1.452 |
| Bagged trees (depth 3, min-leaf 6) | 1.361 | 1.027 | 1.476 | 1.348 |
| Gradient boosting (square loss, 200 rounds, depth 2) | 1.308 | 1.491 | 1.820 | 1.697 |
| Kernel / k-NN (k 21, plain median) | 1.545 | 1.069 | 1.391 | 1.216 |
| **Piecewise GAM (6 TVL bins, isotonic, shrinkage 3, age on)** | 1.300 | **1.133** | **1.250** | 1.285 |
| Linear (ridge λ=30, + (log TVL)²) | 1.369 | 1.170 | 1.310 | 1.226 |
| Stacked blend (kernel at its chosen config, weight 0.7) | 1.390 | 0.979 | 1.296 | 1.279 |

Why the GAM, on that table: it is the only challenger that beats the incumbent on three of the four reads — time, stratified and pooled — and it is the closest of the six on the fourth (hash, 1.300 against the incumbent's home-game 1.209). The kernel and linear families post lower pooled CV, but both lose the stratified split outright and fall much further behind on the hash split; the blend owns the time split and loses both other splits. Pooled CV is also the read that re-chooses every configuration inside every fold, so nothing in it is scored on a split its constants were picked on — the property split A lacks for the incumbent. This was a judgement call by the entrant, not a protocol result, and it is recorded as one: the bar was not moved retroactively inside the audit; the audit stands as written above, and the decision to ship against it is the entrant's, stated here and in the dashboard.

The shipped GAM is the audit's implementation ported into `lib/gam.ts` and fitted on all 128 traded protocols; the port reproduces the harness's numbers exactly (shipped-form A 1.2996, B 1.1326, C 1.2503; full-fit MdALE 0.900 — an in-sample figure, quoted only to be dismissed as evidence, exactly as launch-radar-3's was).

## What it cannot do

Its typical held-out price is off by a factor of ≈3.7 (hash split) to ≈3.1 (time split); only 29% and 34% of held-out protocols were priced within 2×. Treat every implied value as a ranking with a wide range around it, never as a quote. The time split is the harder and more honest test — protocols listed later price worse than earlier ones — so expect drift as the market regime moves. 33 of the 128 traded protocols record no listing date and sit out the time split. And the model prices a token as if issued against the record in the snapshot: it says nothing about whether or when one is issued.

## Farm plans

Every board row carries a seven-step plan built from that protocol's own record: the cheapest chain it serves and the bridge route in, the product surface to use (named from its category), a deposit sized to its TVL and implied value with a stated dollar figure, a cadence matched to its 7-day TVL trend, a qualifying window derived from its age, a points/multiplier watch, a parallel position in a traded comparable from its own category, and the claim-and-exit step. A plan that ignores cost and time is a horoscope; these carry both.

## The dossier

`dossier.json` is written by the vendored `vendor/makefun-board.ts` `buildDossier`, called with the kit's own caps (dashboard ≤ 400 files / 4 MiB, screenshots ≤ 4 × 512 KiB, text ≤ 64 KiB per file), so the submitted dossier is byte-for-byte the file the grader rebuilds. Dashboard source totals ≈37 KB so it travels whole. Screenshots are real 1440×900 captures of the generated dashboard: the board, the top-ranked protocol's detail view, and the watchlist-only filtered board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

`/input` is where the grader mounts the sealed snapshot; `--input` also accepts a directory holding `snapshot.json`, and `MAKEFUN_OUTPUT_DIR` stands in for `/output` outside the grader. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, and the same input always produces the same bytes. Reproduce the validation with `node tools/validate.mjs`. No dependencies anywhere; Node ≥ 22 runs the TypeScript directly.

Model: **launch-radar-4** · Source: DefiLlama snapshot, as of 2026-11-14 · Not investment advice.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hhk4ynvx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
