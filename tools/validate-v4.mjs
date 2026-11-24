// Launch Radar v4 audit harness — the stricter test launch-radar-3 was put through
// before any v4 could replace it. It changes nothing in the shipped model; it exists
// so the record of WHY launch-radar-3 still stands is reproducible.
//
// What v4 tried, and what this harness runs:
//   * A third validation split, C "stratified": within each category, protocols sorted
//     by slug alternate train/test, so every multi-member category appears in both
//     halves and no verdict can be an artefact of category composition.
//   * Variant fitting by cross-validation instead of v3's in-sample choice: in-sample
//     selection is biased toward the most aggressive variant (in this round's walk
//     experiments it picked momentum w=0.9 on both original splits, which then hurt
//     held-out). Here each form's variants are fitted by an inner 5-fold CV (folds by
//     FNV-1a of the slug mod 5).
//   * Selection over whole model forms by pooled 5-fold CV across all 128 traded
//     protocols, because per-split held-out halves of 47–69 protocols make a noisy
//     median, and both the greedy walk (path-dependent verdicts) and marginal term
//     testing (blind to the category×scale interaction) proved unstable here.
//   * Candidate forms are declared in advance and built only from terms already in
//     play. Winsorise and breadth are excluded: across every procedure tried they
//     changed no held-out median in almost every context (a winsorise clamp cannot
//     move a median it does not bind). The momentum-window term (growth_clamp) was
//     also tested in the walk experiments: the fitted window was the hand-set
//     [-40, +60] in every momentum-active context, and its marginal held-out effect
//     was 0.0% on all three splits — the median protocol's 7-day change sits inside
//     every candidate window, so clamping rarely binds at the median.
//   * The incumbent competes as a fixed form with its exact shipped parameters.
// The bar, set before the run: a fitted form replaces launch-radar-3 only if it beats
// the incumbent in pooled CV AND its shipped form (parameters refitted per split
// train, the evaluation that produced launch-radar-3's published numbers) beats
// launch-radar-3's shipped form on BOTH original splits — A < 1.2086 and B < 1.4953.
// Run it: node tools/validate-v4.mjs <snapshot.json> [--json <out>]

import { readFileSync, writeFileSync } from 'node:fs';
import { buildComparables, parseSnapshot, predictValue, V2_PARAMS } from '../lib/model.ts';
import { FITTED_PARAMS } from '../lib/fitted.ts';

const FOLDS = 5;

const BASE_PARAMS = {
  ...V2_PARAMS,
  use_category: false,
  ratio_floor: 0.001,
  ratio_cap: 50,
  elasticity: 1,
  growth_weight: 0,
  maturity_base: 1,
  maturity_span: 0,
  unknown_age_maturity: 1,
  breadth_per_chain: 0,
};

const unknownAgeFor = (base, span) => base + span * (Math.log(1 + 365) / Math.log(1 + 1825));

const TERM_DEFS = {
  category: {
    label: 'Category multiples (shrunk toward the global median)',
    variants: [3, 5, 10].map((k) => ({
      name: `category medians, shrinkage K=${k}`,
      apply: (p) => ({ ...p, use_category: true, shrinkage_k: k }),
    })),
  },
  scale: {
    label: 'TVL elasticity (value scales as TVL^elasticity around $100M)',
    // The grid extends below v3's {0.9, 0.95, 1.05}: both v3 splits fitted at or next
    // to that grid's lower edge (0.95 on A, 0.9 on B) — the standard truncated-grid
    // signal, read off v3's training fits alone.
    variants: [0.8, 0.85, 0.9, 0.95, 1.05].map((beta) => ({
      name: `elasticity ${beta}`,
      apply: (p) => ({ ...p, elasticity: beta }),
    })),
  },
  momentum: {
    label: 'Momentum (7-day TVL change)',
    variants: [0.3, 0.6, 0.9].map((w) => ({
      name: `growth weight ${w}`,
      apply: (p) => ({ ...p, growth_weight: w }),
    })),
  },
  maturity: {
    label: 'Maturity (time running with no token)',
    variants: [
      [0.78, 0.44],
      [0.88, 0.24],
      [0.68, 0.64],
    ].map(([base, span]) => ({
      name: `base ${base}, span ${span}`,
      apply: (p) => ({ ...p, maturity_base: base, maturity_span: span, unknown_age_maturity: unknownAgeFor(base, span) }),
    })),
  },
};

/** Candidate forms, declared in advance. `fixed` competes with frozen parameters. */
const FORMS = [
  { key: 'v3-incumbent', terms: ['category', 'scale', 'momentum'], fixed: FITTED_PARAMS },
  { key: 'cat', terms: ['category'] },
  { key: 'cat+scale', terms: ['category', 'scale'] },
  { key: 'cat+scale+mom', terms: ['category', 'scale', 'momentum'] },
  { key: 'cat+scale+mom+mat', terms: ['category', 'scale', 'momentum', 'maturity'] },
];

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function score(pairs) {
  const errs = pairs.map(({ pred, actual }) => Math.log(pred) - Math.log(actual));
  return {
    n: pairs.length,
    mdale: medianOf(errs.map(Math.abs)),
    bias: errs.reduce((a, b) => a + b, 0) / errs.length,
    within_2x: errs.filter((e) => Math.abs(e) <= Math.log(2)).length / errs.length,
  };
}

function evaluate(params, fitSet, targetSet, asOf) {
  const comps = buildComparables(fitSet, params);
  return score(targetSet.map((p) => ({ pred: predictValue(p, comps, asOf, params), actual: p.mcap_usd })));
}

function cvScore(params, train, asOf) {
  let sum = 0;
  let used = 0;
  for (let f = 0; f < FOLDS; f++) {
    const fold = train.filter((p) => fnv1a(p.slug) % FOLDS === f);
    if (fold.length === 0) continue;
    const fit = train.filter((p) => fnv1a(p.slug) % FOLDS !== f);
    sum += evaluate(params, fit, fold, asOf).mdale;
    used += 1;
  }
  return sum / used;
}

/** Fit a form's terms on `fitSet`: walk order, each variant chosen by inner CV. */
function fitForm(form, fitSet, asOf) {
  if (form.fixed) return { params: { ...form.fixed }, choices: ['(fixed launch-radar-3 parameters)'] };
  let params = { ...BASE_PARAMS };
  const choices = [];
  for (const key of form.terms) {
    const term = TERM_DEFS[key];
    let best = null;
    for (const variant of term.variants) {
      const candidate = variant.apply(params);
      const cv = cvScore(candidate, fitSet, asOf);
      if (best === null || cv < best.cv) best = { variant, candidate, cv };
    }
    choices.push(`${key}: ${best.variant.name}`);
    params = best.candidate;
  }
  return { params, choices };
}

const args = process.argv.slice(2);
const snapshotFile = args[0];
if (!snapshotFile) {
  process.stderr.write('usage: node tools/validate-v4.mjs <snapshot.json> [--json <out>]\n');
  process.exit(2);
}
const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const asOf = snapshot.as_of;
const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);

// Pooled outer CV over all traded protocols.
const formResults = FORMS.map((form) => {
  const foldReads = [];
  for (let f = 0; f < FOLDS; f++) {
    const fold = traded.filter((p) => fnv1a(p.slug) % FOLDS === f);
    const fit = traded.filter((p) => fnv1a(p.slug) % FOLDS !== f);
    const { params } = fitForm(form, fit, asOf);
    foldReads.push({ fold: f, n: fold.length, ...evaluate(params, fit, fold, asOf) });
  }
  return {
    form: form.key,
    terms: form.terms,
    fixed: Boolean(form.fixed),
    pooled_cv_mdale: foldReads.reduce((a, r) => a + r.mdale, 0) / foldReads.length,
    folds: foldReads,
  };
});
const incumbent = formResults.find((r) => r.form === 'v3-incumbent');
const fittedForms = formResults.filter((r) => !r.fixed).sort((a, b) => a.pooled_cv_mdale - b.pooled_cv_mdale);
const winner = fittedForms[0];
const winnerForm = FORMS.find((f) => f.key === winner.form);
const winnerBeatsIncumbent = winner.pooled_cv_mdale < incumbent.pooled_cv_mdale;

// Refit the winning form on all traded protocols.
const { params: winnerParams, choices: winnerChoices } = fitForm(winnerForm, traded, asOf);

// The three splits: A hash parity, B time order, C category-stratified.
const hashTrain = traded.filter((p) => fnv1a(p.slug) % 2 === 0);
const hashTest = traded.filter((p) => fnv1a(p.slug) % 2 === 1);
const dated = traded
  .filter((p) => p.listed_at !== null)
  .sort((a, b) => (a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : a.slug < b.slug ? -1 : 1));
const timeTrain = dated.slice(0, Math.ceil(dated.length / 2));
const timeTest = dated.slice(Math.ceil(dated.length / 2));
const byCategory = new Map();
for (const p of traded) {
  const key = p.category ?? 'Uncategorised';
  const list = byCategory.get(key) ?? [];
  list.push(p);
  byCategory.set(key, list);
}
const stratTrain = [];
const stratTest = [];
for (const group of byCategory.values()) {
  const sorted = [...group].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  sorted.forEach((p, i) => (i % 2 === 0 ? stratTrain : stratTest).push(p));
}
const splitDefs = [
  { name: 'A: hash split (slug coin flip)', train: hashTrain, test: hashTest },
  { name: 'B: time split (fit the past, test the future)', train: timeTrain, test: timeTest, excluded_n: traded.length - dated.length },
  { name: 'C: stratified split (alternating within each category)', train: stratTrain, test: stratTest },
];

// Shipped-form reads: parameters fitted on all traded protocols, comparables refitted
// per split train — the same evaluation that produced launch-radar-3's published rows.
const shippedFormRead = (params) => splitDefs.map((d) => ({ split: d.name, ...evaluate(params, d.train, d.test, asOf) }));
const incumbentShipped = shippedFormRead(FITTED_PARAMS);
const winnerShipped = shippedFormRead(winnerParams);

const report = {
  as_of: asOf,
  traded_n: traded.length,
  folds: FOLDS,
  forms: formResults,
  winner: winner.form,
  winner_beats_incumbent_cv: winnerBeatsIncumbent,
  winner_choices_full_fit: winnerChoices,
  winner_params: winnerParams,
  incumbent_shipped_form_heldout: incumbentShipped,
  winner_shipped_form_heldout: winnerShipped,
  full_fit: {
    winner: evaluate(winnerParams, traded, traded, asOf),
    incumbent: evaluate(FITTED_PARAMS, traded, traded, asOf),
  },
};

const num = (x) => x.toFixed(4);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
process.stdout.write(`launch radar v4 audit: ${traded.length} traded protocols, snapshot as of ${asOf}\n\npooled ${FOLDS}-fold CV over all traded protocols:\n`);
for (const r of formResults) {
  process.stdout.write(
    `  ${r.form.padEnd(20)} pooled CV MdALE ${num(r.pooled_cv_mdale)}  folds: ${r.folds.map((f) => num(f.mdale)).join(', ')}\n`,
  );
}
process.stdout.write(
  `\nbest fitted form: ${winner.form} (pooled CV ${num(winner.pooled_cv_mdale)} vs incumbent ${num(incumbent.pooled_cv_mdale)}; beats incumbent in CV: ${winnerBeatsIncumbent})\n` +
    `full-fit choices: ${winnerChoices.join('; ')}\n` +
    `\nshipped form, refitted per split train:\n` +
    `  launch-radar-3 (incumbent):\n` +
    incumbentShipped.map((r) => `    ${r.split}: MdALE ${num(r.mdale)}, within 2x ${pct(r.within_2x)}`).join('\n') +
    `\n  ${winner.form} (v4 candidate):\n` +
    winnerShipped.map((r) => `    ${r.split}: MdALE ${num(r.mdale)}, within 2x ${pct(r.within_2x)}`).join('\n') +
    '\n',
);

// The verdict, against the bar set before the run: pooled-CV win AND shipped-form
// wins on both original splits. Anything less and launch-radar-3 stands.
const beatsA = winnerShipped[0].mdale < incumbentShipped[0].mdale;
const beatsB = winnerShipped[1].mdale < incumbentShipped[1].mdale;
report.verdict = {
  winner_beats_incumbent_cv: winnerBeatsIncumbent,
  winner_beats_incumbent_on_A: beatsA,
  winner_beats_incumbent_on_B: beatsB,
  ship_v4: winnerBeatsIncumbent && beatsA && beatsB,
};
process.stdout.write(
  `verdict: pooled-CV win ${winnerBeatsIncumbent}, shipped-form win on A ${beatsA}, on B ${beatsB} -> ` +
    (report.verdict.ship_v4 ? `ship ${winner.form} as launch-radar-4\n` : 'launch-radar-3 stands; no v4 ships\n'),
);

const optValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const jsonOut = optValue('--json');
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
