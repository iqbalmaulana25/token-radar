// Launch Radar's shipped price model since launch-radar-4: a piecewise multiplicative
// GAM in log space, ported line for line from the v5 audit harness (tools/validate-v5.mjs),
// where it competed as the "gam" family against five other model families on the frozen
// snapshot. Its configuration was chosen there by inner 5-fold cross-validation over the
// 128 traded protocols and is the configuration shipped here: 6 TVL bins, an isotonic
// (non-increasing) TVL shape, shrinkage 3, and the age term on.
//
//   log(implied value) = log(TVL) + level
//     + category offset + TVL-shape offset + momentum offset + age offset
//
// Each offset is a shrunk binned median of backfitting residuals: the category offset is
// per category, the TVL shape is a free step function of log TVL (forced non-increasing
// by pool-adjacent-violators, so a dollar of TVL never prices higher just for sitting in
// a bigger protocol), momentum is binned on the clamped 7-day TVL change, and age is
// binned on normalised age. Three backfitting passes, then whatever level is left over
// sits in a constant, so the pieces stay offsets. The fit is deterministic: fixed bin
// edges from the fit set's own quantiles, fixed pass order, no clock, no randomness.
//
// Held-out record (shipped form, from tools/validation-v5-results.json): hash split
// MdALE 1.2996, time split 1.1326, stratified split 1.2503, pooled 5-fold CV 1.2855 —
// against launch-radar-3's 1.2086 / 1.4953 / 1.2671 / 1.4516. It loses the hash split
// and wins the other three reads; it ships because the entrant chose pooled CV as the
// deciding read. The README tells the whole story.

import { ageDays, type SnapshotProtocol } from './model.ts';

/** The shipped GAM configuration: the one the v5 audit's inner CV chose. */
export interface GamConfig {
  bins: number;
  iso: boolean;
  shrink: number;
  age: boolean;
}

export const GAM_CONFIG: GamConfig = { bins: 6, iso: true, shrink: 3, age: true };

const AGE_SPAN = Math.log(1 + 1825);
const MOM_EDGES = [-0.1, 0, 0.1, 0.3]; // on growth (already /100, clamped to [-0.4, 0.6]): 5 fixed bins

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-quantile of a non-empty list, nearest-rank — the same rule lib/model.ts uses. */
function quantileOf(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

/** Pool-adjacent-violators: weighted non-increasing isotonic fit of bin values. */
function pavaDecreasing(values: number[], weights: number[]): number[] {
  const blocks = values.map((v, i) => ({ v, w: weights[i]!, n: 1 }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i + 1 < blocks.length; i++) {
      if (blocks[i]!.v < blocks[i + 1]!.v) {
        const w = blocks[i]!.w + blocks[i + 1]!.w;
        blocks[i] = { v: (blocks[i]!.v * blocks[i]!.w + blocks[i + 1]!.v * blocks[i + 1]!.w) / w, w, n: blocks[i]!.n + blocks[i + 1]!.n };
        blocks.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.v);
  return out;
}

/** Quantile bin edges of a fit-set column: b bins, edges at sorted positions. */
function binEdges(values: number[], b: number): number[] {
  const sorted = [...values].sort((a, c) => a - c);
  const edges: number[] = [];
  for (let q = 1; q < b; q++) edges.push(sorted[Math.min(sorted.length - 1, Math.floor((q / b) * sorted.length))]!);
  return edges;
}

function binOf(edges: number[], v: number): number {
  let b = 0;
  while (b < edges.length && v > edges[b]!) b += 1;
  return b;
}

/** The three signals the GAM reads, exactly as the audit harness computes them. */
interface Signals {
  lt: number;
  gr: number;
  ageN: number;
}

function signals(p: SnapshotProtocol, asOf: string, ageFill: number): Signals {
  const age = ageDays(asOf, p.listed_at);
  return {
    lt: Math.log(p.tvl_usd),
    gr: Math.min(60, Math.max(-40, p.change_7d ?? 0)) / 100,
    ageN: age === null ? ageFill : Math.log(1 + age) / AGE_SPAN,
  };
}

/** A fitted GAM: the bin edges and offset tables a price is read from. */
export interface GamModel {
  config: GamConfig;
  ageFill: number;
  tvlEdges: number[];
  ageEdges: number[];
  catOff: Map<string, number>;
  tvlOff: number[];
  momOff: number[];
  ageOff: number[];
  level: number;
  fitN: number;
}

/**
 * Fit the GAM on a set of traded protocols (the audit harness's fitGam, unchanged in
 * substance): three backfitting passes over category, TVL shape, momentum and age,
 * each piece a median of the current residuals shrunk toward a zero offset.
 */
export function fitGam(fitSet: SnapshotProtocol[], asOf: string, cfg: GamConfig = GAM_CONFIG): GamModel {
  const ages = fitSet
    .map((p) => ageDays(asOf, p.listed_at))
    .filter((a): a is number => a !== null)
    .map((a) => Math.log(1 + a) / AGE_SPAN);
  const ageFill = ages.length > 0 ? medianOf(ages) : 0.5;
  const rows = fitSet.map((p) => ({
    x: signals(p, asOf, ageFill),
    r: Math.log(p.mcap_usd! / p.tvl_usd),
    cat: p.category ?? 'Uncategorised',
  }));
  const tvlEdges = binEdges(rows.map((r) => r.x.lt), cfg.bins);
  const ageEdges = binEdges(rows.map((r) => r.x.ageN), 4);
  const shrunkMedian = (vals: number[]): number => {
    const n = vals.length;
    return (n * medianOf(vals) + cfg.shrink * 0) / (n + cfg.shrink); // shrink toward 0 offset
  };
  let catOff = new Map<string, number>();
  let tvlOff = new Array<number>(cfg.bins).fill(0);
  let momOff = new Array<number>(MOM_EDGES.length + 1).fill(0);
  let ageOff = new Array<number>(5).fill(0);
  const off = (r: (typeof rows)[number]): number =>
    (catOff.get(r.cat) ?? 0) +
    tvlOff[binOf(tvlEdges, r.x.lt)]! +
    momOff[binOf(MOM_EDGES, r.x.gr)]! +
    (cfg.age ? ageOff[binOf(ageEdges, r.x.ageN)]! : 0);
  for (let pass = 0; pass < 3; pass++) {
    // Category offsets: shrunk medians of the residual, per category.
    const byCat = new Map<string, number[]>();
    for (const r of rows) {
      const list = byCat.get(r.cat) ?? [];
      list.push(r.r - (off(r) - (catOff.get(r.cat) ?? 0)));
      byCat.set(r.cat, list);
    }
    catOff = new Map([...byCat].map(([c, vals]) => [c, shrunkMedian(vals)]));
    // TVL shape: binned medians of the residual, optionally isotonic.
    const tvlBins: number[][] = Array.from({ length: cfg.bins }, () => []);
    for (const r of rows) tvlBins[binOf(tvlEdges, r.x.lt)]!.push(r.r - (off(r) - tvlOff[binOf(tvlEdges, r.x.lt)]!));
    let raw = tvlBins.map((vals, i) => (vals.length > 0 ? (vals.length * medianOf(vals)) / (vals.length + cfg.shrink) : tvlOff[i]!));
    if (cfg.iso) raw = pavaDecreasing(raw, tvlBins.map((v) => Math.max(1, v.length)));
    tvlOff = raw;
    // Momentum offsets: fixed bins of the 7-day change.
    const momBins: number[][] = Array.from({ length: MOM_EDGES.length + 1 }, () => []);
    for (const r of rows) momBins[binOf(MOM_EDGES, r.x.gr)]!.push(r.r - (off(r) - momOff[binOf(MOM_EDGES, r.x.gr)]!));
    momOff = momBins.map((vals, i) => (vals.length > 0 ? (vals.length * medianOf(vals)) / (vals.length + cfg.shrink) : momOff[i]!));
    // Age offsets: quantile bins of normalised age.
    if (cfg.age) {
      const ageBins: number[][] = Array.from({ length: 5 }, () => []);
      for (const r of rows) ageBins[binOf(ageEdges, r.x.ageN)]!.push(r.r - (off(r) - ageOff[binOf(ageEdges, r.x.ageN)]!));
      ageOff = ageBins.map((vals, i) => (vals.length > 0 ? (vals.length * medianOf(vals)) / (vals.length + cfg.shrink) : ageOff[i]!));
    }
  }
  // Any overall level left over sits in a constant, so the pieces stay offsets.
  const level = medianOf(rows.map((r) => r.r - off(r)));
  return { config: cfg, ageFill, tvlEdges, ageEdges, catOff, tvlOff, momOff, ageOff, level, fitN: fitSet.length };
}

/** The GAM's pieces for one protocol: the offsets its log price is assembled from. */
export interface GamParts {
  level: number;
  category: number;
  tvlShape: number;
  momentum: number;
  age: number;
  logRatio: number;
  logValue: number;
}

/** Decompose one protocol's price: log value = log TVL + level + the four offsets. */
export function gamParts(model: GamModel, p: SnapshotProtocol, asOf: string): GamParts {
  const x = signals(p, asOf, model.ageFill);
  const category = model.catOff.get(p.category ?? 'Uncategorised') ?? 0;
  const tvlShape = model.tvlOff[binOf(model.tvlEdges, x.lt)]!;
  const momentum = model.momOff[binOf(MOM_EDGES, x.gr)]!;
  const age = model.config.age ? model.ageOff[binOf(model.ageEdges, x.ageN)]! : 0;
  const logRatio = model.level + category + tvlShape + momentum + age;
  return { level: model.level, category, tvlShape, momentum, age, logRatio, logValue: Math.log(p.tvl_usd) + logRatio };
}

/** The GAM's predicted log market cap of one protocol (the audit harness's predictGam). */
export function gamLogValue(model: GamModel, p: SnapshotProtocol, asOf: string): number {
  return gamParts(model, p, asOf).logValue;
}

/**
 * The model's own middle-half band: the p25 and p75 of its log residuals on the fit
 * set, as multiplicative factors. The board's ranges are the point price moved by
 * these — the error the model actually made on the protocols it was fitted on,
 * stated instead of hidden.
 */
export function gamResidualBand(model: GamModel, fitSet: SnapshotProtocol[], asOf: string): { low: number; high: number } {
  const residuals = fitSet.map((p) => gamLogValue(model, p, asOf) - Math.log(p.mcap_usd!));
  return { low: Math.exp(quantileOf(residuals, 0.25)), high: Math.exp(quantileOf(residuals, 0.75)) };
}

/** The GAM's in-sample median absolute log error on its fit set (a fit diagnostic, not a held-out read). */
export function gamFullFitMdale(model: GamModel, fitSet: SnapshotProtocol[], asOf: string): number {
  const errs = fitSet.map((p) => Math.abs(gamLogValue(model, p, asOf) - Math.log(p.mcap_usd!)));
  return medianOf(errs);
}
