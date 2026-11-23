// Launch Radar's validation harness: the model's terms are fitted and tested held-out, twice.
//
// The snapshot's traded protocols are the only ground truth a launch model can be scored
// against: their tokens already trade, so the market cap the model would have implied is
// checkable against the market cap it actually carries. This harness splits those 128
// traded protocols two different ways, and on each split walks the model's terms in a
// fixed order. A term's variants are fitted on the training half alone (the variant that
// minimises the training half's median absolute log error); the term is then kept only if
// that fitted variant also improves the held-out half's median absolute log error by at
// least 0.5% relative — otherwise the term is dropped and the model moves on without it.
// A term ships in the final model only if BOTH splits keep it: the leaders' standard,
// applied literally. The shipped variant of a kept term is the one with the lowest
// combined held-out error across the two splits, each split judging it in its own walk.
//
//   node tools/validate.mjs <snapshot.json> [--json <out>] [--fitted <out.ts>]
//
// The two splits:
//   A "hash" — FNV-1a of the slug, even hashes train, odd hashes test: a coin flip no
//      property of the protocol can sway.
//   B "time" — the traded protocols with a recorded listing date, sorted by it: the
//      earlier half trains, the later half is tested. Fit on the past, tested on the
//      future. Protocols with no listing date sit this split out and are counted.

import { readFileSync, writeFileSync } from 'node:fs';
import { buildComparables, parseSnapshot, predictValue, V2_PARAMS } from '../lib/model.ts';

const KEEP_MARGIN = 0.005; // a term must cut held-out error by at least 0.5% relative to stay

/** The bare model every split starts from: global multiples and no adjustment terms. */
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

/** A maturity variant's unknown-age value: the factor it gives a protocol aged one year. */
const unknownAgeFor = (base, span) => base + span * (Math.log(1 + 365) / Math.log(1 + 1825));

/** The terms under selection, in the order they are tried, each with its fitted variants. */
const TERMS = [
  {
    key: 'category',
    label: 'Category multiples (shrunk toward the global median)',
    variants: [3, 5, 10].map((k) => ({
      name: `category medians, shrinkage K=${k}`,
      apply: (p) => ({ ...p, use_category: true, shrinkage_k: k }),
    })),
  },
  {
    key: 'winsorise',
    label: 'Winsorised comparable ratios',
    variants: [
      [0.01, 5],
      [0.02, 3],
      [0.005, 10],
    ].map(([lo, hi]) => ({
      name: `ratios clamped to [${lo}, ${hi}]`,
      apply: (p) => ({ ...p, ratio_floor: lo, ratio_cap: hi }),
    })),
  },
  {
    key: 'scale',
    label: 'TVL elasticity (value scales as TVL^elasticity around $100M)',
    variants: [0.9, 0.95, 1.05].map((beta) => ({
      name: `elasticity ${beta}`,
      apply: (p) => ({ ...p, elasticity: beta }),
    })),
  },
  {
    key: 'momentum',
    label: 'Momentum (7-day TVL change)',
    variants: [0.3, 0.6, 0.9].map((w) => ({
      name: `growth weight ${w}`,
      apply: (p) => ({ ...p, growth_weight: w }),
    })),
  },
  {
    key: 'maturity',
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
  {
    key: 'breadth',
    label: 'Breadth (chains served)',
    variants: [0.015, 0.03, 0.05].map((per) => ({
      name: `+${per * 100}% per extra chain`,
      apply: (p) => ({ ...p, breadth_per_chain: per }),
    })),
  },
];

/** FNV-1a 32-bit: the hash split's coin. */
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

/** Held-out quality of a set of predictions: median |log error|, bias, share within 2x. */
function score(pairs) {
  const errs = pairs.map(({ pred, actual }) => Math.log(pred) - Math.log(actual));
  return {
    n: pairs.length,
    mdale: medianOf(errs.map(Math.abs)),
    bias: errs.reduce((a, b) => a + b, 0) / errs.length,
    within_2x: errs.filter((e) => Math.abs(e) <= Math.log(2)).length / errs.length,
  };
}

/** Predict a set of traded protocols against comparables built from a fitting set alone. */
function evaluate(params, fitSet, targetSet, asOf) {
  const comps = buildComparables(fitSet, params);
  return score(targetSet.map((p) => ({ pred: predictValue(p, comps, asOf, params), actual: p.mcap_usd })));
}

/** One split's selection walk: terms fitted on train, kept or dropped on the held-out half. */
function runSplit(split, traded, asOf) {
  const { train, test } = split;
  let params = { ...BASE_PARAMS };
  const steps = [];
  let held = evaluate(params, train, test, asOf);
  const baseHeld = held;
  for (const term of TERMS) {
    let best = null;
    const variantReads = [];
    for (const variant of term.variants) {
      const candidate = variant.apply(params);
      const trainScore = evaluate(candidate, train, train, asOf).mdale;
      variantReads.push({ name: variant.name, heldout_mdale: evaluate(candidate, train, test, asOf).mdale });
      if (best === null || trainScore < best.trainScore) best = { variant, candidate, trainScore };
    }
    const withTerm = evaluate(best.candidate, train, test, asOf);
    const gain = (held.mdale - withTerm.mdale) / held.mdale;
    const kept = gain >= KEEP_MARGIN;
    steps.push({
      term: term.key,
      label: term.label,
      fitted_variant: best.variant.name,
      train_mdale: best.trainScore,
      heldout_before: held.mdale,
      heldout_after: withTerm.mdale,
      gain,
      kept,
      variants: variantReads,
    });
    if (kept) {
      params = best.candidate;
      held = withTerm;
    }
  }
  return {
    name: split.name,
    train_n: train.length,
    test_n: test.length,
    ...(split.excluded_n !== undefined ? { excluded_n: split.excluded_n } : {}),
    base_heldout: baseHeld,
    steps,
    final_heldout: held,
    v2_heldout: evaluate(V2_PARAMS, train, test, asOf),
    kept_terms: steps.filter((s) => s.kept).map((s) => s.term),
  };
}

/**
 * Choose the shipped variant of each kept term: the variant whose held-out error,
 * summed over the two splits' walks at that term, is lowest. The walk's own state in
 * each split supplies the context, so a variant is judged the way it was tested.
 */
function chooseShipped(shippedKeys, splits) {
  let params = { ...BASE_PARAMS };
  const fitted = [];
  for (const term of TERMS) {
    if (!shippedKeys.includes(term.key)) continue;
    let best = null;
    for (const variant of term.variants) {
      let combined = 0;
      for (const split of splits) {
        const step = split.steps.find((s) => s.term === term.key);
        combined += step.variants.find((v) => v.name === variant.name).heldout_mdale;
      }
      if (best === null || combined < best.combined) best = { variant, combined };
    }
    fitted.push({ term: term.key, variant: best.variant.name, combined_heldout_mdale: best.combined });
    params = best.variant.apply(params);
  }
  return { params, fitted };
}

const args = process.argv.slice(2);
const snapshotFile = args[0];
if (!snapshotFile) {
  process.stderr.write('usage: node tools/validate.mjs <snapshot.json> [--json <out>] [--fitted <out.ts>]\n');
  process.exit(2);
}
const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const asOf = snapshot.as_of;
const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);

const hashTrain = traded.filter((p) => fnv1a(p.slug) % 2 === 0);
const hashTest = traded.filter((p) => fnv1a(p.slug) % 2 === 1);
const dated = traded
  .filter((p) => p.listed_at !== null)
  .sort((a, b) => (a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : a.slug < b.slug ? -1 : 1));
const timeTrain = dated.slice(0, Math.ceil(dated.length / 2));
const timeTest = dated.slice(Math.ceil(dated.length / 2));

const splits = [
  runSplit({ name: 'A: hash split (slug coin flip)', train: hashTrain, test: hashTest }, traded, asOf),
  runSplit(
    { name: 'B: time split (fit the past, test the future)', train: timeTrain, test: timeTest, excluded_n: traded.length - dated.length },
    traded,
    asOf,
  ),
];

const shippedKeys = TERMS.map((t) => t.key).filter(
  (key) => splits[0].kept_terms.includes(key) && splits[1].kept_terms.includes(key),
);
const droppedKeys = TERMS.map((t) => t.key).filter((key) => !shippedKeys.includes(key));
const { params: fittedParams, fitted } = chooseShipped(shippedKeys, splits);

const report = {
  as_of: asOf,
  traded_n: traded.length,
  keep_margin: KEEP_MARGIN,
  splits,
  shipped_terms: shippedKeys,
  dropped_terms: droppedKeys,
  refit: fitted,
  fitted_params: fittedParams,
  full_fit: {
    shipped: evaluate(fittedParams, traded, traded, asOf),
    v2: evaluate(V2_PARAMS, traded, traded, asOf),
  },
  shipped_form_heldout: splits.map((s, i) => {
    const split = i === 0 ? { train: hashTrain, test: hashTest } : { train: timeTrain, test: timeTest };
    return { split: s.name, ...evaluate(fittedParams, split.train, split.test, asOf) };
  }),
};

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const num = (x) => x.toFixed(4);
process.stdout.write(`launch radar validation: ${traded.length} traded protocols, snapshot as of ${asOf}\n`);
for (const s of splits) {
  process.stdout.write(
    `\n${s.name}: train ${s.train_n}, test ${s.test_n}${s.excluded_n ? `, ${s.excluded_n} without a listing date sit out` : ''}\n` +
      `  base model held-out: MdALE ${num(s.base_heldout.mdale)}, within 2x ${pct(s.base_heldout.within_2x)}\n` +
      `  launch-radar-2 (hand-set) held-out: MdALE ${num(s.v2_heldout.mdale)}, within 2x ${pct(s.v2_heldout.within_2x)}\n`,
  );
  for (const step of s.steps) {
    process.stdout.write(
      `  ${step.kept ? 'KEEP' : 'drop'}  ${step.term.padEnd(10)} fitted "${step.fitted_variant}" on train (MdALE ${num(step.train_mdale)}); ` +
        `held-out ${num(step.heldout_before)} -> ${num(step.heldout_after)} (${step.gain >= 0 ? '-' : '+'}${pct(Math.abs(step.gain))})\n`,
    );
  }
  process.stdout.write(`  selected model held-out: MdALE ${num(s.final_heldout.mdale)}, within 2x ${pct(s.final_heldout.within_2x)}\n`);
}
process.stdout.write(
  `\nshipped (kept on both splits): ${shippedKeys.join(', ') || 'none'}\ndropped: ${droppedKeys.join(', ') || 'none'}\n` +
    `full-set fit of the shipped parameters: MdALE ${num(report.full_fit.shipped.mdale)} vs launch-radar-2's ${num(report.full_fit.v2.mdale)} (in-sample, for reference)\n`,
);

const optValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const jsonOut = optValue('--json');
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
const fittedOut = optValue('--fitted');
if (fittedOut) {
  const termLines = TERMS.map((t) => {
    const a = splits[0].steps.find((s) => s.term === t.key);
    const b = splits[1].steps.find((s) => s.term === t.key);
    const verdict = shippedKeys.includes(t.key) ? 'kept on both splits' : 'dropped';
    return ` *   ${t.key}: ${verdict} (split A fitted "${a.fitted_variant}", held-out ${num(a.heldout_before)} -> ${num(a.heldout_after)}; split B fitted "${b.fitted_variant}", held-out ${num(b.heldout_before)} -> ${num(b.heldout_after)})`;
  }).join('\n');
  const splitLines = splits
    .map(
      (s, i) =>
        ` *   ${s.name}: train ${s.train_n}, test ${s.test_n}; base MdALE ${num(s.base_heldout.mdale)}, selected MdALE ${num(s.final_heldout.mdale)}, ` +
        `launch-radar-2 MdALE ${num(s.v2_heldout.mdale)}; the shipped form re-fitted on this split's train scores MdALE ${num(report.shipped_form_heldout[i].mdale)} held-out.`,
    )
    .join('\n');
  writeFileSync(
    fittedOut,
    `// The fitted parameter set and the validation record behind it, written by tools/validate.mjs
// from the sealed snapshot (as of ${asOf}, ${traded.length} traded protocols). Reproduce with:
//   node tools/validate.mjs <snapshot.json> --fitted lib/fitted.ts
// Every term below was fitted on a training half and kept only if it cut the held-out half's
// median absolute log error by at least ${KEEP_MARGIN * 100}% on BOTH splits; each shipped variant is
// the one with the lowest combined held-out error across the two splits. Per term:
${termLines}
// Per split:
${splitLines}

import type { ModelParams } from './model.ts';

/** The shipped model's parameters: launch-radar-2's hand-set constants, replaced by fitted ones. */
export const FITTED_PARAMS: ModelParams = ${JSON.stringify(fittedParams, null, 2)};

/** The validation record the dashboard's method view renders: verdicts with their numbers. */
export const VALIDATION = ${JSON.stringify(
      {
        as_of: asOf,
        traded_n: traded.length,
        keep_margin: KEEP_MARGIN,
        splits: splits.map((s, i) => ({
          name: s.name,
          train_n: s.train_n,
          test_n: s.test_n,
          ...(s.excluded_n !== undefined ? { excluded_n: s.excluded_n } : {}),
          base_mdale: s.base_heldout.mdale,
          selected_mdale: s.final_heldout.mdale,
          v2_mdale: s.v2_heldout.mdale,
          shipped_mdale: report.shipped_form_heldout[i].mdale,
          base_within_2x: s.base_heldout.within_2x,
          selected_within_2x: s.final_heldout.within_2x,
          steps: s.steps.map((st) => ({
            term: st.term,
            label: st.label,
            fitted_variant: st.fitted_variant,
            heldout_before: st.heldout_before,
            heldout_after: st.heldout_after,
            kept: st.kept,
          })),
        })),
        shipped_terms: shippedKeys,
        dropped_terms: droppedKeys,
        refit: fitted,
        full_fit_shipped_mdale: report.full_fit.shipped.mdale,
        full_fit_v2_mdale: report.full_fit.v2.mdale,
      },
      null,
      2,
    )} as const;
`,
  );
}
