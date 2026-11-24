// Launch Radar v5 audit harness — the round that changes the model FAMILY, not the terms.
//
// launch-radar-3 is a parametric multiplicative form: a shrunk category median ratio,
// one global TVL elasticity, one linear momentum factor. The v3 round fitted its terms;
// the v4 round (tools/validate-v4.mjs) refitted them under stricter procedures and the
// incumbent survived, because every same-family challenger that gained on the time
// split lost on the hash split. What neither round ever tried is a different functional
// family altogether: a model that learns the shape of the price from the traded
// protocols instead of assuming it. That is this round.
//
// Candidate families, declared in advance, all fitted on the same frozen snapshot and
// all predicting log market cap from the same five signals the record carries —
// log TVL, clamped 7-day TVL change, normalised age, chain count, and a shrunk
// category target encoding (the category's median log ratio, fitted on the training
// set alone wherever it is used):
//
//   trees-bag    Bagged regression trees (bootstrap resamples, fixed seed): 200 trees,
//                median leaves. Grid: depth {3,4,5} x min-leaf {3,6}.
//   trees-boost  Gradient boosting, stage-wise and deterministic. Grid: loss
//                {square, absolute} x rounds {200,400} x depth {2,3}, rate 0.05.
//   kernel       Kernel / k-nearest-neighbour regression in standardised feature
//                space, predicting a (kernel-weighted) median of log market cap.
//                Grid: k {8,13,21} x {plain median, Gaussian-weighted median}.
//   gam          A multiplicative model whose pieces are free step functions instead
//                of global constants: an isotonic (or free) binned response of the log
//                ratio to log TVL, shrunk category offsets, binned momentum offsets,
//                optional binned age offsets, fitted by backfitting. Grid: TVL bins
//                {6,10} x {isotonic, free} x shrinkage {3,8} x age {off, on}.
//   linear       Linear regression on the five signals (plus an optional log-TVL
//                quadratic): ridge by closed form, or median (LAD) regression by
//                IRLS — the loss MdALE itself rewards. Grid: ridge lambda
//                {0.3,1,3,10,30} and LAD, x quadratic {off, on}.
//   blend        A stacked ensemble: the incumbent's own log prediction averaged
//                with one partner family's, weight w toward the partner. The
//                partner competes at the configuration its own inner CV chose in
//                this same run (fixed inside the blend, exactly as the incumbent's
//                constants are fixed), and w is chosen by the blend's own inner
//                CV — the split reads select nothing here either. Grid: partner
//                {gam, linear, kernel, trees-bag} x w {0.3, 0.5, 0.7}.
//
// The protocol is v4's, unchanged, so the numbers stand next to the published ones:
//   * Each family's configuration is chosen by inner 5-fold CV (folds by FNV-1a of the
//     slug mod 5) over all 128 traded protocols — the full-fit configuration.
//   * The shipped-form read: that configuration, refitted on each split's training
//     half, scored on its held-out half — splits A (hash parity), B (time order) and
//     C (category-stratified), built exactly as validate-v4.mjs builds them. The
//     incumbent's shipped-form reads under the same construction are A 1.2086,
//     B 1.4953, C 1.2671.
//   * Two corroborating reads: a nested read (configuration chosen by inner CV on
//     each split's training half alone) and a pooled outer 5-fold CV with the
//     configuration re-chosen inside every outer fold, against the incumbent's
//     pooled CV of 1.4516.
// The bar, set before the run and the same bar v4 used: a family replaces
// launch-radar-3 only if its shipped-form read beats the incumbent on BOTH original
// splits — A < 1.2086 AND B < 1.4953. Anything less and launch-radar-3 stands and
// this harness is the record of why.
// Everything is deterministic: fixed seeds, fixed iteration orders, no clock, no
// Math.random. Run it: node tools/validate-v5.mjs <snapshot.json> [--json <out>]

import { readFileSync, writeFileSync } from 'node:fs';
import { ageDays, buildComparables, parseSnapshot, predictValue } from '../lib/model.ts';
import { FITTED_PARAMS } from '../lib/fitted.ts';

const FOLDS = 5;

// ---------------------------------------------------------------------------
// Shared utilities (the v4 harness's, so scores are computed identically).
// ---------------------------------------------------------------------------

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

function meanOf(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function score(pairs) {
  const errs = pairs.map(({ pred, actual }) => Math.log(pred) - Math.log(actual));
  return {
    n: pairs.length,
    mdale: medianOf(errs.map(Math.abs)),
    bias: meanOf(errs),
    within_2x: errs.filter((e) => Math.abs(e) <= Math.log(2)).length / errs.length,
  };
}

/** Score a list of {yhat (log mcap), actual (mcap)} predictions the same way. */
function scoreLog(preds) {
  return score(preds.map(({ yhat, actual }) => ({ pred: Math.exp(yhat), actual })));
}

/** mulberry32: a small deterministic PRNG; the only source of "randomness" allowed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Features. Everything a family may see, with every statistic that needs
// fitting (age fill, category encoding, standardisation) fitted on the fit
// set alone and applied to whatever set is being priced.
// ---------------------------------------------------------------------------

const AGE_SPAN = Math.log(1 + 1825);

function rawSignals(p, asOf) {
  const age = ageDays(asOf, p.listed_at);
  return {
    lt: Math.log(p.tvl_usd),
    gr: Math.min(60, Math.max(-40, typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0)) / 100,
    ageN: age === null ? null : Math.log(1 + age) / AGE_SPAN,
    ch: Math.min(p.chains.length, 8),
    cat: p.category ?? 'Uncategorised',
    logRatio: Math.log(p.mcap_usd / p.tvl_usd),
  };
}

/** Fit-set statistics + a feature extractor closing over them. */
function makeFeatures(fitSet, asOf) {
  const sig = fitSet.map((p) => rawSignals(p, asOf));
  const ages = sig.filter((s) => s.ageN !== null).map((s) => s.ageN);
  const ageFill = ages.length > 0 ? medianOf(ages) : 0.5;
  // Shrunk category target encoding of the log ratio (K = 5, thin categories borrow).
  const globalCatR = medianOf(sig.map((s) => s.logRatio));
  const byCat = new Map();
  for (const s of sig) {
    const list = byCat.get(s.cat) ?? [];
    list.push(s.logRatio);
    byCat.set(s.cat, list);
  }
  const catR = new Map();
  for (const [cat, values] of byCat) {
    const n = values.length;
    catR.set(cat, n < 3 ? globalCatR : (n * medianOf(values) + 5 * globalCatR) / (n + 5));
  }
  const feat = (p) => {
    const s = rawSignals(p, asOf);
    return [s.lt, s.gr, s.ageN ?? ageFill, s.ch, catR.get(s.cat) ?? globalCatR];
  };
  const stats = {
    mean: [0, 1, 2, 3, 4].map((j) => meanOf(fitSet.map((p) => feat(p)[j]))),
    sd: [0, 1, 2, 3, 4].map((j) => {
      const col = fitSet.map((p) => feat(p)[j]);
      const m = meanOf(col);
      return Math.max(1e-9, Math.sqrt(meanOf(col.map((v) => (v - m) ** 2))));
    }),
  };
  return { feat, stats, ageFill, catR, globalCatR };
}

const yOf = (p) => Math.log(p.mcap_usd);

// ---------------------------------------------------------------------------
// Regression trees: one deterministic CART builder shared by bagging and
// boosting. Splits minimise within-leaf variance of the working response;
// leaf values are the leaf mean or median of it, per the caller.
// ---------------------------------------------------------------------------

function buildTree(X, resp, idx, depth, maxDepth, minLeaf, leafStat) {
  const values = idx.map((i) => resp[i]);
  const leafValue = leafStat === 'median' ? medianOf(values) : meanOf(values);
  if (depth >= maxDepth || idx.length < 2 * minLeaf) return { leaf: leafValue };
  const n = idx.length;
  const totalMean = meanOf(values);
  let totalSSE = 0;
  for (const v of values) totalSSE += (v - totalMean) ** 2;
  let best = null;
  for (let f = 0; f < X[0].length; f++) {
    const order = [...idx].sort((a, b) => X[a][f] - X[b][f]);
    // Candidate cuts: at most 20 evenly spaced positions between distinct values.
    const cuts = [];
    for (let q = 1; q < 24; q++) {
      const pos = Math.floor((q / 24) * n);
      if (pos >= minLeaf && pos <= n - minLeaf && X[order[pos - 1]][f] < X[order[pos]][f]) cuts.push(pos);
    }
    let sumL = 0;
    let sqL = 0;
    let seen = 0;
    let ci = 0;
    for (let pos = 1; pos < n; pos++) {
      const v = resp[order[pos - 1]];
      sumL += v;
      sqL += v * v;
      seen += 1;
      while (ci < cuts.length && cuts[ci] === pos) {
        const nL = seen;
        const nR = n - seen;
        const sumR = values.reduce((a, b) => a + b, 0) - sumL;
        const sqR = values.reduce((a, v2) => a + v2 * v2, 0) - sqL;
        const sse = sqL - (sumL * sumL) / nL + (sqR - (sumR * sumR) / nR);
        if (best === null || sse < best.sse) best = { f, at: (X[order[pos - 1]][f] + X[order[pos]][f]) / 2, sse };
        ci += 1;
      }
      if (ci >= cuts.length && pos > (cuts[cuts.length - 1] ?? n)) break;
    }
  }
  if (best === null || best.sse >= totalSSE - 1e-12) return { leaf: leafValue };
  const left = idx.filter((i) => X[i][best.f] <= best.at);
  const right = idx.filter((i) => X[i][best.f] > best.at);
  if (left.length < minLeaf || right.length < minLeaf) return { leaf: leafValue };
  return {
    f: best.f,
    at: best.at,
    l: buildTree(X, resp, left, depth + 1, maxDepth, minLeaf, leafStat),
    r: buildTree(X, resp, right, depth + 1, maxDepth, minLeaf, leafStat),
  };
}

function treePredict(node, x) {
  let cur = node;
  while (cur.leaf === undefined) cur = x[cur.f] <= cur.at ? cur.l : cur.r;
  return cur.leaf;
}

// ---------------------------------------------------------------------------
// Family: bagged trees. Bootstrap resamples from a fixed seed; each tree sees
// all five signals; the ensemble prediction is the mean of the trees' median
// leaves (the mean of medians — stable, and every step reproducible).
// ---------------------------------------------------------------------------

function fitBag(X, y, cfg, seed) {
  const rand = mulberry32(seed);
  const n = y.length;
  const trees = [];
  for (let t = 0; t < cfg.trees; t++) {
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(Math.floor(rand() * n));
    trees.push(buildTree(X, y, idx, 0, cfg.depth, cfg.minLeaf, 'median'));
  }
  return { trees };
}

function predictBag(model, x) {
  return meanOf(model.trees.map((t) => treePredict(t, x)));
}

// ---------------------------------------------------------------------------
// Family: gradient boosting. Stage-wise additive trees on the working
// response: residuals for square loss, signs for absolute loss (whose leaf
// medians make each stage a step toward the conditional median — the
// quantity MdALE scores). No subsampling: fully deterministic.
// ---------------------------------------------------------------------------

function fitBoost(X, y, cfg) {
  const init = medianOf(y);
  const pred = y.map(() => init);
  const trees = [];
  const all = y.map((_, i) => i);
  for (let r = 0; r < cfg.rounds; r++) {
    const resp = y.map((v, i) => (cfg.loss === 'square' ? v - pred[i] : Math.sign(v - pred[i])));
    const tree = buildTree(X, resp, all, 0, cfg.depth, cfg.minLeaf, cfg.loss === 'square' ? 'mean' : 'median');
    trees.push(tree);
    for (let i = 0; i < y.length; i++) pred[i] += cfg.rate * treePredict(tree, X[i]);
  }
  return { init, trees, rate: cfg.rate };
}

function predictBoost(model, x) {
  return model.init + model.rate * model.trees.reduce((a, t) => a + treePredict(t, x), 0);
}

// ---------------------------------------------------------------------------
// Family: kernel / k-nearest neighbours in standardised feature space.
// The prediction is a median of neighbours' log market caps — plain, or
// Gaussian-weighted with the bandwidth set by the k-th neighbour's distance.
// ---------------------------------------------------------------------------

function fitKernel(X, y, stats, cfg) {
  const Z = X.map((x) => x.map((v, j) => (v - stats.mean[j]) / stats.sd[j]));
  return { Z, y, cfg, stats };
}

function predictKernel(model, x) {
  const z = x.map((v, j) => (v - model.stats.mean[j]) / model.stats.sd[j]);
  const dists = model.Z.map((zi, i) => ({ d: Math.sqrt(zi.reduce((a, v, j) => a + (v - z[j]) ** 2, 0)), y: model.y[i] }));
  dists.sort((a, b) => a.d - b.d || a.y - b.y);
  const near = dists.slice(0, Math.min(model.cfg.k, dists.length));
  if (model.cfg.mode === 'plain') return medianOf(near.map((e) => e.y));
  const h = Math.max(near[near.length - 1].d, 1e-9);
  const weighted = near.map((e) => ({ y: e.y, w: Math.exp(-(e.d * e.d) / (2 * h * h)) }));
  weighted.sort((a, b) => a.y - b.y);
  const total = weighted.reduce((a, e) => a + e.w, 0);
  let acc = 0;
  for (const e of weighted) {
    acc += e.w;
    if (acc >= total / 2) return e.y;
  }
  return weighted[weighted.length - 1].y;
}

// ---------------------------------------------------------------------------
// Family: piecewise-calibrated multiplicative model (a GAM in log space).
// log value = log TVL + f_tvl(log TVL) + f_cat(category) + f_mom(growth)
// [+ f_age(age)], where each f is a shrunk binned median of residuals and
// f_tvl may be forced non-increasing (isotonic, PAVA) — the shape the
// elasticity term assumes, here learned as a free step function instead.
// ---------------------------------------------------------------------------

/** Pool-adjacent-violators: weighted non-increasing isotonic fit of bin values. */
function pavaDecreasing(values, weights) {
  const blocks = values.map((v, i) => ({ v, w: weights[i], n: 1 }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i + 1 < blocks.length; i++) {
      if (blocks[i].v < blocks[i + 1].v) {
        const w = blocks[i].w + blocks[i + 1].w;
        blocks[i] = { v: (blocks[i].v * blocks[i].w + blocks[i + 1].v * blocks[i + 1].w) / w, w, n: blocks[i].n + blocks[i + 1].n };
        blocks.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  const out = [];
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.v);
  return out;
}

/** Quantile bin edges of a fit-set column: b bins, edges at sorted positions. */
function binEdges(values, b) {
  const sorted = [...values].sort((a, c) => a - c);
  const edges = [];
  for (let q = 1; q < b; q++) edges.push(sorted[Math.min(sorted.length - 1, Math.floor((q / b) * sorted.length))]);
  return edges;
}

function binOf(edges, v) {
  let b = 0;
  while (b < edges.length && v > edges[b]) b += 1;
  return b;
}

const MOM_EDGES = [-0.1, 0, 0.1, 0.3]; // on gr (already /100, clamped to [-0.4, 0.6]): 5 fixed bins

function fitGam(fitSet, asOf, cfg) {
  const F = makeFeatures(fitSet, asOf);
  const rows = fitSet.map((p) => {
    const x = F.feat(p);
    return { p, x, r: Math.log(p.mcap_usd / p.tvl_usd), cat: p.category ?? 'Uncategorised' };
  });
  const tvlEdges = binEdges(rows.map((r) => r.x[0]), cfg.bins);
  const ageEdges = binEdges(rows.map((r) => r.x[2]), 4);
  const shrunkMedian = (vals) => {
    const n = vals.length;
    return (n * medianOf(vals) + cfg.shrink * 0) / (n + cfg.shrink); // shrink toward 0 offset
  };
  // Backfitting: three passes over category, TVL shape, momentum, age.
  let catOff = new Map();
  let tvlOff = new Array(cfg.bins).fill(0);
  let momOff = new Array(MOM_EDGES.length + 1).fill(0);
  let ageOff = new Array(5).fill(0);
  const off = (r) =>
    (catOff.get(r.cat) ?? 0) + tvlOff[binOf(tvlEdges, r.x[0])] + momOff[binOf(MOM_EDGES, r.x[1])] + (cfg.age ? ageOff[binOf(ageEdges, r.x[2])] : 0);
  for (let pass = 0; pass < 3; pass++) {
    // Category offsets: shrunk medians of the residual, per category.
    const byCat = new Map();
    for (const r of rows) {
      const list = byCat.get(r.cat) ?? [];
      list.push(r.r - (off(r) - (catOff.get(r.cat) ?? 0)));
      byCat.set(r.cat, list);
    }
    catOff = new Map([...byCat].map(([c, vals]) => [c, shrunkMedian(vals)]));
    // TVL shape: binned medians of the residual, optionally isotonic.
    const tvlBins = Array.from({ length: cfg.bins }, () => []);
    for (const r of rows) tvlBins[binOf(tvlEdges, r.x[0])].push(r.r - (off(r) - tvlOff[binOf(tvlEdges, r.x[0])]));
    let raw = tvlBins.map((vals, i) => (vals.length > 0 ? (vals.length * medianOf(vals)) / (vals.length + cfg.shrink) : tvlOff[i]));
    if (cfg.iso) raw = pavaDecreasing(raw, tvlBins.map((v) => Math.max(1, v.length)));
    tvlOff = raw;
    // Momentum offsets: fixed bins of the 7-day change.
    const momBins = Array.from({ length: MOM_EDGES.length + 1 }, () => []);
    for (const r of rows) momBins[binOf(MOM_EDGES, r.x[1])].push(r.r - (off(r) - momOff[binOf(MOM_EDGES, r.x[1])]));
    momOff = momBins.map((vals, i) => (vals.length > 0 ? (vals.length * medianOf(vals)) / (vals.length + cfg.shrink) : momOff[i]));
    // Age offsets (optional): quantile bins of normalised age.
    if (cfg.age) {
      const ageBins = Array.from({ length: 5 }, () => []);
      for (const r of rows) ageBins[binOf(ageEdges, r.x[2])].push(r.r - (off(r) - ageOff[binOf(ageEdges, r.x[2])]));
      ageOff = ageBins.map((vals, i) => (vals.length > 0 ? (vals.length * medianOf(vals)) / (vals.length + cfg.shrink) : ageOff[i]));
    }
  }
  // Any overall level left over sits in a constant, so the pieces stay offsets.
  const level = medianOf(rows.map((r) => r.r - off(r)));
  return { F, tvlEdges, ageEdges, catOff, tvlOff, momOff, ageOff, level, cfg };
}

function predictGam(model, p, asOf) {
  const x = model.F.feat(p);
  const cat = p.category ?? 'Uncategorised';
  const logRatio =
    model.level +
    (model.catOff.get(cat) ?? 0) +
    model.tvlOff[binOf(model.tvlEdges, x[0])] +
    model.momOff[binOf(MOM_EDGES, x[1])] +
    (model.cfg.age ? model.ageOff[binOf(model.ageEdges, x[2])] : 0);
  return Math.log(p.tvl_usd) + logRatio;
}

// ---------------------------------------------------------------------------
// Family: linear models on the five signals — ridge by closed form, and
// median (LAD) regression by IRLS from the ridge start. Features are
// standardised; an optional (log TVL)^2 term lets the line bend once.
// ---------------------------------------------------------------------------

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

function designMatrix(X, stats, quad) {
  return X.map((x) => {
    const z = x.map((v, j) => (v - stats.mean[j]) / stats.sd[j]);
    return quad ? [...z, z[0] * z[0]] : z;
  });
}

function fitLinear(X, y, stats, cfg) {
  const Z = designMatrix(X, stats, cfg.quad);
  const d = Z[0].length;
  const yMean = meanOf(y);
  const yc = y.map((v) => v - yMean);
  const ridge = (lambda, weights) => {
    const A = Array.from({ length: d }, () => new Array(d).fill(0));
    const b = new Array(d).fill(0);
    for (let i = 0; i < Z.length; i++) {
      const w = weights ? weights[i] : 1;
      for (let a = 0; a < d; a++) {
        b[a] += w * Z[i][a] * yc[i];
        for (let c = 0; c < d; c++) A[a][c] += w * Z[i][a] * Z[i][c];
      }
    }
    for (let a = 0; a < d; a++) A[a][a] += lambda;
    return solveLinear(A, b);
  };
  let beta = ridge(cfg.method === 'ridge' ? cfg.lambda : 1e-3, null);
  let intercept = yMean;
  if (cfg.method === 'lad') {
    for (let it = 0; it < 60; it++) {
      const resid = Z.map((z, i) => yc[i] - z.reduce((a, v, j) => a + v * beta[j], 0));
      const weights = resid.map((r) => 1 / Math.max(Math.abs(r), 0.05));
      beta = ridge(1e-3, weights);
    }
    const resid = Z.map((z, i) => y[i] - z.reduce((a, v, j) => a + v * beta[j], 0));
    intercept = medianOf(resid);
  }
  return { beta, intercept, stats, quad: cfg.quad };
}

function predictLinear(model, x) {
  const z = designMatrix([x], model.stats, model.quad)[0];
  return model.intercept + z.reduce((a, v, j) => a + v * model.beta[j], 0);
}

// ---------------------------------------------------------------------------
// The families and their declared grids. Every fit returns a predictor
// closure (protocol -> predicted log market cap); every statistic a family
// needs is fitted inside the closure's fit set and nowhere else.
// ---------------------------------------------------------------------------

const FAMILIES = [
  {
    key: 'trees-bag',
    label: 'Bagged regression trees (200 trees, median leaves)',
    configs: [3, 4, 5].flatMap((depth) =>
      [3, 6].map((minLeaf) => ({ name: `depth ${depth}, min-leaf ${minLeaf}`, depth, minLeaf, trees: 200 })),
    ),
    fit(fitSet, asOf, cfg, seed) {
      const F = makeFeatures(fitSet, asOf);
      const model = fitBag(fitSet.map((p) => F.feat(p)), fitSet.map(yOf), cfg, seed);
      return (p) => predictBag(model, F.feat(p));
    },
  },
  {
    key: 'trees-boost',
    label: 'Gradient boosting (stage-wise trees, rate 0.05)',
    configs: ['square', 'absolute'].flatMap((loss) =>
      [200, 400].flatMap((rounds) =>
        [2, 3].map((depth) => ({ name: `${loss} loss, ${rounds} rounds, depth ${depth}`, loss, rounds, depth, rate: 0.05, minLeaf: 5 })),
      ),
    ),
    fit(fitSet, asOf, cfg) {
      const F = makeFeatures(fitSet, asOf);
      const model = fitBoost(fitSet.map((p) => F.feat(p)), fitSet.map(yOf), cfg);
      return (p) => predictBoost(model, F.feat(p));
    },
  },
  {
    key: 'kernel',
    label: 'Kernel / k-nearest neighbours (standardised space, median)',
    configs: [8, 13, 21].flatMap((k) =>
      ['plain', 'kernel'].map((mode) => ({ name: `k ${k}, ${mode === 'plain' ? 'plain median' : 'Gaussian-weighted median'}`, k, mode })),
    ),
    fit(fitSet, asOf, cfg) {
      const F = makeFeatures(fitSet, asOf);
      const model = fitKernel(fitSet.map((p) => F.feat(p)), fitSet.map(yOf), F.stats, cfg);
      return (p) => predictKernel(model, F.feat(p));
    },
  },
  {
    key: 'gam',
    label: 'Piecewise multiplicative GAM (binned/isotonic step functions)',
    configs: [6, 10].flatMap((bins) =>
      [true, false].flatMap((iso) =>
        [3, 8].flatMap((shrink) =>
          [false, true].map((age) => ({
            name: `${bins} TVL bins, ${iso ? 'isotonic' : 'free'}, shrinkage ${shrink}, age ${age ? 'on' : 'off'}`,
            bins,
            iso,
            shrink,
            age,
          })),
        ),
      ),
    ),
    fit(fitSet, asOf, cfg) {
      const model = fitGam(fitSet, asOf, cfg);
      return (p) => predictGam(model, p, asOf);
    },
  },
  {
    key: 'linear',
    label: 'Linear models (ridge closed form; LAD median regression by IRLS)',
    configs: [
      ...[0.3, 1, 3, 10, 30].flatMap((lambda) =>
        [false, true].map((quad) => ({ name: `ridge lambda ${lambda}${quad ? ', + (log TVL)^2' : ''}`, method: 'ridge', lambda, quad })),
      ),
      ...[false, true].map((quad) => ({ name: `LAD median regression${quad ? ', + (log TVL)^2' : ''}`, method: 'lad', lambda: 0, quad })),
    ],
    fit(fitSet, asOf, cfg) {
      const F = makeFeatures(fitSet, asOf);
      const model = fitLinear(fitSet.map((p) => F.feat(p)), fitSet.map(yOf), F.stats, cfg);
      return (p) => predictLinear(model, F.feat(p));
    },
  },
];

// ---------------------------------------------------------------------------
// The protocol: v4's splits, v4's folds, v4's scoring.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const snapshotFile = args[0];
if (!snapshotFile) {
  process.stderr.write('usage: node tools/validate-v5.mjs <snapshot.json> [--json <out>]\n');
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

const seedFor = (familyKey, cfgIdx, salt) => (fnv1a(`${familyKey}|${cfgIdx}|${salt}`) ^ 0x9e3779b9) >>> 0;

function evalPredictor(predict, targetSet) {
  return scoreLog(targetSet.map((p) => ({ yhat: predict(p), actual: p.mcap_usd })));
}

/** Mean inner-CV MdALE of one configuration on one set (folds by slug hash). */
function innerCV(family, cfg, cfgIdx, set, salt) {
  let sum = 0;
  let used = 0;
  for (let f = 0; f < FOLDS; f++) {
    const fold = set.filter((p) => fnv1a(p.slug) % FOLDS === f);
    if (fold.length === 0) continue;
    const fit = set.filter((p) => fnv1a(p.slug) % FOLDS !== f);
    sum += evalPredictor(family.fit(fit, asOf, cfg, seedFor(family.key, cfgIdx, `${salt}|${f}`)), fold).mdale;
    used += 1;
  }
  return sum / used;
}

function selectConfig(family, set, salt) {
  let best = null;
  family.configs.forEach((cfg, idx) => {
    const cv = innerCV(family, cfg, idx, set, salt);
    if (best === null || cv < best.cv) best = { cfg, idx, cv };
  });
  return best;
}

// The incumbent's reads under this harness's own construction (they reproduce
// the published launch-radar-3 numbers; the report asserts nothing it did not
// recompute).
function incumbentEvaluate(fitSet, targetSet) {
  const comps = buildComparables(fitSet, FITTED_PARAMS);
  return score(targetSet.map((p) => ({ pred: predictValue(p, comps, asOf, FITTED_PARAMS), actual: p.mcap_usd })));
}
const incumbentShipped = splitDefs.map((d) => ({ split: d.name, ...incumbentEvaluate(d.train, d.test) }));
const incumbentPooled = (() => {
  let sum = 0;
  for (let f = 0; f < FOLDS; f++) {
    const fold = traded.filter((p) => fnv1a(p.slug) % FOLDS === f);
    const fit = traded.filter((p) => fnv1a(p.slug) % FOLDS !== f);
    sum += incumbentEvaluate(fit, fold).mdale;
  }
  return sum / FOLDS;
})();

const evaluateFamily = (family) => {
  // Full-fit configuration: chosen by inner CV over all traded protocols.
  const chosen = selectConfig(family, traded, 'full');
  // Shipped-form read: that configuration refitted per split train.
  const shipped = splitDefs.map((d) => ({
    split: d.name,
    ...evalPredictor(family.fit(d.train, asOf, chosen.cfg, seedFor(family.key, chosen.idx, `ship|${d.name}`)), d.test),
  }));
  // Nested read: configuration re-chosen inside each split's training half.
  const nested = splitDefs.map((d) => {
    const c = selectConfig(family, d.train, `nested|${d.name}`);
    return { split: d.name, config: c.cfg.name, ...evalPredictor(family.fit(d.train, asOf, c.cfg, seedFor(family.key, c.idx, `nested|${d.name}`)), d.test) };
  });
  // Pooled outer CV: configuration re-chosen inside every outer fold.
  let pooledSum = 0;
  const pooledFolds = [];
  for (let f = 0; f < FOLDS; f++) {
    const fold = traded.filter((p) => fnv1a(p.slug) % FOLDS === f);
    const fit = traded.filter((p) => fnv1a(p.slug) % FOLDS !== f);
    const c = selectConfig(family, fit, `pooled|${f}`);
    const read = evalPredictor(family.fit(fit, asOf, c.cfg, seedFor(family.key, c.idx, `pooled|${f}`)), fold);
    pooledFolds.push({ fold: f, n: fold.length, config: c.cfg.name, ...read });
    pooledSum += read.mdale;
  }
  return {
    family: family.key,
    label: family.label,
    chosen_config: chosen.cfg.name,
    chosen_inner_cv: chosen.cv,
    shipped_form_heldout: shipped,
    nested_heldout: nested,
    pooled_cv_mdale: pooledSum / FOLDS,
    pooled_folds: pooledFolds,
    full_fit: evalPredictor(family.fit(traded, asOf, chosen.cfg, seedFor(family.key, chosen.idx, 'fullfit')), traded),
    beats_incumbent_on_A: shipped[0].mdale < incumbentShipped[0].mdale,
    beats_incumbent_on_B: shipped[1].mdale < incumbentShipped[1].mdale,
  };
};

const familyResults = FAMILIES.map(evaluateFamily);

// The blend family, built after the five partners have their chosen
// configurations: each partner competes inside the blend at exactly the
// configuration its own inner CV picked above.
const chosenConfigOf = {};
for (const r of familyResults) {
  const fam = FAMILIES.find((f) => f.key === r.family);
  chosenConfigOf[r.family] = fam.configs.find((c) => c.name === r.chosen_config);
}
const blendFamily = {
  key: 'blend',
  label: 'Stacked blend of launch-radar-3 with a partner family (log-space average)',
  configs: ['gam', 'linear', 'kernel', 'trees-bag'].flatMap((partner) =>
    [0.3, 0.5, 0.7].map((w) => ({ name: `${partner} at its chosen config, weight ${w}`, partner, w })),
  ),
  fit(fitSet, asOf, cfg, seed) {
    const partner = FAMILIES.find((f) => f.key === cfg.partner);
    const partnerPredict = partner.fit(fitSet, asOf, chosenConfigOf[cfg.partner], seed);
    const comps = buildComparables(fitSet, FITTED_PARAMS);
    return (p) => (1 - cfg.w) * Math.log(predictValue(p, comps, asOf, FITTED_PARAMS)) + cfg.w * partnerPredict(p);
  },
};
familyResults.push(evaluateFamily(blendFamily));

const clearing = familyResults.filter((r) => r.beats_incumbent_on_A && r.beats_incumbent_on_B);
clearing.sort((a, b) => a.shipped_form_heldout[0].mdale + a.shipped_form_heldout[1].mdale - (b.shipped_form_heldout[0].mdale + b.shipped_form_heldout[1].mdale));
const shipFamily = clearing.length > 0 ? clearing[0] : null;

const report = {
  as_of: asOf,
  traded_n: traded.length,
  folds: FOLDS,
  incumbent: {
    model: 'launch-radar-3',
    shipped_form_heldout: incumbentShipped,
    pooled_cv_mdale: incumbentPooled,
    full_fit: incumbentEvaluate(traded, traded),
  },
  families: familyResults,
  verdict: {
    bar: { A_below: incumbentShipped[0].mdale, B_below: incumbentShipped[1].mdale },
    families_clearing_both: clearing.map((r) => r.family),
    ship: shipFamily !== null,
    ship_family: shipFamily ? shipFamily.family : null,
  },
};

const num = (x) => x.toFixed(4);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
process.stdout.write(`launch radar v5 audit (model families): ${traded.length} traded protocols, snapshot as of ${asOf}\n\n`);
process.stdout.write(
  `incumbent launch-radar-3, recomputed: pooled CV ${num(incumbentPooled)}; shipped form ` +
    incumbentShipped.map((r) => `${r.split.split(':')[0]} ${num(r.mdale)}`).join(', ') +
    '\n\n',
);
process.stdout.write('family'.padEnd(14) + 'chosen configuration'.padEnd(58) + 'innerCV  pooledCV   A       B       C\n');
for (const r of familyResults) {
  const s = r.shipped_form_heldout;
  process.stdout.write(
    `${r.family.padEnd(14)}${r.chosen_config.padEnd(58)}${num(r.chosen_inner_cv)}  ${num(r.pooled_cv_mdale)}  ${num(s[0].mdale)}  ${num(s[1].mdale)}  ${num(s[2].mdale)}` +
      `  (within 2x A ${pct(s[0].within_2x)}, B ${pct(s[1].within_2x)}, C ${pct(s[2].within_2x)})\n`,
  );
}
process.stdout.write(
  `\nverdict: bar is A < ${num(incumbentShipped[0].mdale)} AND B < ${num(incumbentShipped[1].mdale)} (shipped-form reads). ` +
    (shipFamily
      ? `${shipFamily.family} clears both -> ship it as launch-radar-4\n`
      : 'no family clears both -> launch-radar-3 stands; no new model ships\n'),
);

const optValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const jsonOut = optValue('--json');
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
