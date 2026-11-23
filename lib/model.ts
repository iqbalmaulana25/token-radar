// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks protocols that record no token yet by the value a token would carry if the
// protocol's record stayed as it is. Nothing is predicted about whether or when a token is
// issued: the implied value is this dashboard's own conditional estimate, and every figure in
// it is derived from the snapshot itself — no protocol name is ever special-cased.
//
// How a value is built (model launch-radar-2):
//
//   1. Comparables. Protocols whose token already trades give the market's own price of a
//      dollar of TVL: ratio = mcap_usd / tvl_usd, winsorised to [0.01, 5] so one mania or one
//      dead token cannot bend the scale. The board's base multiple for a protocol is the
//      median ratio of its own category, shrunk toward the global median by the category's
//      sample size (shrinkage K = 5): a category with many traded tokens mostly speaks for
//      itself, a thin one mostly borrows the global figure. Categories with fewer than 3
//      traded comparables use the global median outright.
//   2. Momentum. Seven-day TVL growth, clamped to [-40, +60] percent, scales the value by
//      1 + 0.6 * growth / 100: a protocol gathering TVL is worth more than a shrinking one
//      with the same stock, and the clamp keeps one hot week from dominating.
//   3. Maturity. Days since DefiLlama first tracked the protocol (listed_at to the snapshot's
//      as_of), log-scaled over five years: 0.78 + 0.44 * ln(1 + age) / ln(1 + 1825). A record
//      that has survived years with no token supports a higher conditional value than a
//      fortnight's. An unknown listing date scores a neutral 0.95.
//   4. Breadth. Each chain beyond the first, up to seven, adds 3%: distribution across chains
//      is part of what a token would represent.
//
//   implied_value_usd = round(tvl_usd * multiple * momentum * maturity * breadth)
//
// The detail view also carries a range: the same product with the category's 25th and 75th
// percentile ratios (shrunk the same way) in place of the median.
//
// The board covers every slug on the snapshot's watchlist (the floor, never the ceiling) and
// every other rankable pre-token protocol the snapshot carries: pre-token means the record
// shows no market cap, no CoinGecko id and no symbol; CEX records and names ending in a
// version marker are left out, as products of another protocol or an exchange's own book.
// Protocols whose token already trades are never ranked: they are the comparables, and the
// dashboard sets them apart in their own view with the market's values, not the model's.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'launch-radar-2';

/** The model's constants, stated in the dashboard so a reader can re-derive every value. */
export const MODEL = {
  ratio_floor: 0.01,
  ratio_cap: 5,
  shrinkage_k: 5,
  min_category_samples: 3,
  growth_floor_pct: -40,
  growth_cap_pct: 60,
  growth_weight: 0.6,
  maturity_base: 0.78,
  maturity_span: 0.44,
  maturity_window_days: 1825,
  unknown_age_maturity: 0.95,
  breadth_per_chain: 0.03,
  breadth_max_chains: 7,
} as const;

const DAY_MS = 86_400_000;

/** A whole day count from listed_at to as_of, clamped at zero; null when either date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the record shows no token: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The wrapped, staked and bridged products of a token that already trades are not launches
 * still to come — WBTC is Bitcoin on Ethereum, not a protocol waiting on a token of its own.
 * The board applies the watchlist's own exclusions to everything it adds beyond the floor:
 * the product categories, a wrapped/staked/staking word in the name, an exchange's name at
 * the front of it, and the version marker. Watchlist slugs themselves are always ranked:
 * the floor is covered whatever the filters say.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is one the board may rank: pre-token, and not a product of a traded token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !(p.category !== null && PRODUCT_CATEGORIES.has(p.category)) &&
    !PRODUCT_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !VERSIONED.test(p.name)
  );
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-quantile of a non-empty list of numbers, nearest-rank. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

/** One category's comparable set: how many traded tokens, and their ratio spread. */
export interface CategoryMultiples {
  category: string;
  n: number;
  median: number;
  p25: number;
  p75: number;
}

/** The comparable universe the model prices from: every traded token's winsorised mcap/TVL. */
export interface Comparables {
  global: CategoryMultiples;
  byCategory: Map<string, CategoryMultiples>;
  liveCount: number;
}

/** Build the comparable sets from the snapshot's traded protocols. */
export function buildComparables(snapshot: Snapshot): Comparables {
  const ratio = (p: SnapshotProtocol): number =>
    Math.min(MODEL.ratio_cap, Math.max(MODEL.ratio_floor, p.mcap_usd! / p.tvl_usd));
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const all = live.map(ratio);
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const list = groups.get(key) ?? [];
    list.push(ratio(p));
    groups.set(key, list);
  }
  const describe = (category: string, values: number[]): CategoryMultiples => ({
    category,
    n: values.length,
    median: median(values),
    p25: quantile(values, 0.25),
    p75: quantile(values, 0.75),
  });
  const byCategory = new Map<string, CategoryMultiples>();
  for (const [category, values] of groups) byCategory.set(category, describe(category, values));
  return { global: describe('All categories', all), byCategory, liveCount: live.length };
}

/** Shrink a category statistic toward the global one by the category's sample size. */
function shrunk(catValue: number, globalValue: number, n: number): number {
  if (n < MODEL.min_category_samples) return globalValue;
  return (n * catValue + MODEL.shrinkage_k * globalValue) / (n + MODEL.shrinkage_k);
}

/** The multiples one protocol is priced with: median for the value, p25/p75 for its range. */
export function multiplesFor(p: SnapshotProtocol, comps: Comparables): { multiple: number; low: number; high: number; categoryN: number } {
  const cat = comps.byCategory.get(p.category ?? 'Uncategorised');
  if (cat === undefined) {
    return { multiple: comps.global.median, low: comps.global.p25, high: comps.global.p75, categoryN: 0 };
  }
  return {
    multiple: shrunk(cat.median, comps.global.median, cat.n),
    low: shrunk(cat.p25, comps.global.p25, cat.n),
    high: shrunk(cat.p75, comps.global.p75, cat.n),
    categoryN: cat.n,
  };
}

/** The model's three adjustment factors for one protocol, each stated in the detail view. */
export interface Factors {
  momentum: number;
  maturity: number;
  breadth: number;
  growthPct: number;
  age: number | null;
}

/** Momentum, maturity and breadth for one protocol under the model. */
export function factorsFor(p: SnapshotProtocol, asOf: string): Factors {
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(MODEL.growth_cap_pct, Math.max(MODEL.growth_floor_pct, raw));
  const momentum = 1 + (MODEL.growth_weight * growthPct) / 100;
  const age = ageDays(asOf, p.listed_at);
  const maturity =
    age === null
      ? MODEL.unknown_age_maturity
      : MODEL.maturity_base + MODEL.maturity_span * (Math.log(1 + age) / Math.log(1 + MODEL.maturity_window_days));
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_chains);
  const breadth = 1 + MODEL.breadth_per_chain * extraChains;
  return { momentum, maturity, breadth, growthPct, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_low: number;
    multiple_high: number;
    category_comparables: number;
    momentum: number;
    maturity: number;
    breadth: number;
    implied_low_usd: number;
    implied_high_usd: number;
  };
  farm_steps: string[];
}

/** A traded protocol, set apart from the board: the market's own value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

/** Everything the dashboard renders: the board, the comparables and the model that priced them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  scanned: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  categories: CategoryMultiples[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** The protocols the board ranks, most valuable first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, comps: Comparables): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const m = multiplesFor(p, comps);
    const f = factorsFor(p, snapshot.as_of);
    const adj = f.momentum * f.maturity * f.breadth;
    const implied = Math.max(1, Math.round(p.tvl_usd * m.multiple * adj));
    return { p, m, f, implied };
  });
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.f.age,
    watchlist: watch.has(s.p.slug),
    token_status: 'pre-token',
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.m.multiple),
      multiple_low: round4(s.m.low),
      multiple_high: round4(s.m.high),
      category_comparables: s.m.categoryN,
      momentum: round4(s.f.momentum),
      maturity: round4(s.f.maturity),
      breadth: round4(s.f.breadth),
      implied_low_usd: Math.max(1, Math.round(s.p.tvl_usd * s.m.low * s.f.momentum * s.f.maturity * s.f.breadth)),
      implied_high_usd: Math.max(1, Math.round(s.p.tvl_usd * s.m.high * s.f.momentum * s.f.maturity * s.f.breadth)),
    },
    farm_steps: farmSteps(s.p, s.f.age),
  }));
}

/** The traded protocols by market cap, for the dashboard's comparables view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, 36)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
    }));
}

/** Everything the entry hands in: the ranked board and the dashboard's data. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = buildComparables(snapshot);
  const board = buildBoard(snapshot, comps);
  const categories = [...comps.byCategory.values()]
    .filter((c) => c.n >= MODEL.min_category_samples)
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1))
    .map((c) => ({ ...c, median: round4(c.median), p25: round4(c.p25), p75: round4(c.p75) }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: comps.liveCount,
    global_multiple: round4(comps.global.median),
    categories,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// Farm plans. Each plan is generated from the protocol's own record: its
// category picks the playbook, its primary chain picks the gas profile, its
// TVL picks the position size, its age picks the qualifying window. Every
// step states what it costs and how long it takes.
// ---------------------------------------------------------------------------

/** What one transaction roughly costs on a chain, and the asset gas is paid in. */
interface GasProfile {
  asset: string;
  low: string;
  high: string;
}

const GAS: Record<string, GasProfile> = {
  Ethereum: { asset: 'ETH', low: '$6', high: '$20' },
  Solana: { asset: 'SOL', low: '$0.02', high: '$0.25' },
  BSC: { asset: 'BNB', low: '$0.20', high: '$1' },
  Polygon: { asset: 'POL', low: '$0.01', high: '$0.30' },
  Avalanche: { asset: 'AVAX', low: '$0.20', high: '$1.50' },
  Arbitrum: { asset: 'ETH', low: '$0.10', high: '$1.50' },
  Base: { asset: 'ETH', low: '$0.05', high: '$1' },
  Optimism: { asset: 'ETH', low: '$0.10', high: '$1.50' },
  Linea: { asset: 'ETH', low: '$0.10', high: '$1' },
  Scroll: { asset: 'ETH', low: '$0.10', high: '$1' },
  'zkSync Era': { asset: 'ETH', low: '$0.10', high: '$1' },
  Mantle: { asset: 'MNT', low: '$0.05', high: '$0.80' },
  Blast: { asset: 'ETH', low: '$0.05', high: '$0.80' },
  Sui: { asset: 'SUI', low: '$0.01', high: '$0.20' },
  Aptos: { asset: 'APT', low: '$0.01', high: '$0.20' },
  Tron: { asset: 'TRX', low: '$0.50', high: '$2' },
  Bitcoin: { asset: 'BTC', low: '$1', high: '$8' },
};
const GAS_DEFAULT: GasProfile = { asset: 'the chain gas token', low: '$0.50', high: '$3' };

function gasFor(chain: string): GasProfile {
  return GAS[chain] ?? GAS_DEFAULT;
}

/** The position size a plan works with, scaled to the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 50_000_000) return 120;
  if (tvl >= 15_000_000) return 75;
  return 50;
}

/** The qualifying window in weeks: younger protocols ask for a longer record of activity. */
function holdWeeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  if (age < 730) return 5;
  return 4;
}

/** The two core actions and the weekly action of a category's playbook. */
interface Playbook {
  open: (name: string, chain: string, capital: number) => string;
  deepen: (name: string, chain: string, capital: number) => string;
  weekly: (name: string) => string;
}

const PLAYBOOKS: { match: string[]; book: Playbook }[] = [
  {
    match: ['dex', 'swap'],
    book: {
      open: (n, c, k) => `Provide $${k} of liquidity to ${n}'s highest-volume pair on ${c} (a stablecoin pair if one is offered, to limit impermanent loss) and keep the LP position open`,
      deepen: (n, c, k) => `Route $${Math.max(25, Math.round(k / 4))} of swaps through ${n} itself rather than an aggregator, so the volume is recorded against your wallet`,
      weekly: (n) => `Make one swap of $25 or more and, where ${n} runs gauge or governance voting, cast a vote with any vote-escrow or points weight you hold`,
    },
  },
  {
    match: ['lending', 'cdp', 'collateral'],
    book: {
      open: (n, c, k) => `Supply $${k} of USDC or ETH to ${n} on ${c} as lending collateral and leave the supply position untouched`,
      deepen: (n, c, k) => `Borrow about $${Math.round(k / 3)} against the collateral, hold the borrowed asset for a few days, then repay in full: one clean borrow-repay cycle, never near the liquidation line`,
      weekly: (n) => `Adjust the position once: top the collateral up by $10 or repay a slice of the borrow, so the wallet shows continuing, deliberate use of ${n}`,
    },
  },
  {
    match: ['bridge'],
    book: {
      open: (n, c, k) => `Bridge $${k} of USDC from Ethereum to ${c} through ${n}, and keep the bridged funds working on the destination chain instead of bridging straight back`,
      deepen: (n, c, k) => `Bridge a second, different asset (ETH or a stablecoin you have not moved before) through ${n} to a second destination chain it serves`,
      weekly: (n) => `Make one small bridge of $25 or more in either direction, varying the route, so the wallet's history with ${n} spans separate weeks`,
    },
  },
  {
    match: ['staking', 'restaking', 'restaked'],
    book: {
      open: (n, c, k) => `Stake $${k} of the chain's staking asset through ${n} on ${c} and hold the liquid receipt token in the same wallet`,
      deepen: (n, c, k) => `Put half the receipt token to work in one of ${n}'s listed restaking or vault options, keeping the other half unstaked as your exit reserve`,
      weekly: (n) => `Claim and re-stake any rewards once a week rather than selling them, compounding the position ${n} sees`,
    },
  },
  {
    match: ['derivative', 'perpetual', 'options'],
    book: {
      open: (n, c, k) => `Deposit $${k} of USDC as margin on ${n} and open one small hedged position (long and short legs of similar size) so trading volume accrues without directional risk`,
      deepen: (n, c, k) => `Deposit a further $${Math.round(k / 2)} into ${n}'s liquidity or insurance vault if it offers one, and keep the vault shares for the full window`,
      weekly: (n) => `Roll the hedge once a week and keep total fees in mind: stop for the week once fees pass $5, since ${n} counts consistent traders, not fee donors`,
    },
  },
  {
    match: ['curator', 'allocator'],
    book: {
      open: (n, c, k) => `Deposit $${k} into one of ${n}'s curated vaults on ${c}, choosing the vault whose underlying markets you understand, and keep the vault shares`,
      deepen: (n, c, k) => `Split a second $${Math.round(k / 2)} across a second vault with a different curator strategy, so your activity is not a single deposit`,
      weekly: (n) => `Review the vaults' allocations once a week and move at most one position: curators reward depositors who stay, so churn works against you on ${n}`,
    },
  },
  {
    match: ['rwa'],
    book: {
      open: (n, c, k) => `Complete ${n}'s onboarding or allowlist step if it asks for one, then mint $${k} of its yield-bearing asset on ${c}`,
      deepen: (n, c, k) => `Hold the minted asset past one full yield distribution instead of redeeming at once, so the holding period is on record`,
      weekly: (n) => `Check the asset's reported yield and attestations once a week and add $10 on any week the position is below your target size`,
    },
  },
  {
    match: ['yield'],
    book: {
      open: (n, c, k) => `Deposit $${k} of USDC into ${n}'s main vault on ${c} and keep the vault shares in the farming wallet`,
      deepen: (n, c, k) => `Add a second position of $${Math.round(k / 2)} in a different ${n} vault or strategy, so the wallet uses more than the front-page pool`,
      weekly: (n) => `Harvest and re-deposit any yield once a week rather than withdrawing it, and note the vault's APY in your farm log`,
    },
  },
  {
    match: ['stable'],
    book: {
      open: (n, c, k) => `Mint or deposit $${k} of the stable asset through ${n} on ${c}, using the protocol's own mint or deposit page`,
      deepen: (n, c, k) => `Provide the minted stablecoin as liquidity in one of ${n}'s listed pools, keeping the LP position in the same wallet`,
      weekly: (n) => `Move $25 between the mint and the pool once a week, so the wallet shows continuing use rather than a single mint-and-forget`,
    },
  },
  {
    match: ['insurance'],
    book: {
      open: (n, c, k) => `Buy $${k} of cover from ${n} on ${c} for a position you actually hold, and keep the policy to its term`,
      deepen: (n, c, k) => `Stake $${Math.round(k / 2)} into ${n}'s capital or underwriting pool if it offers one, accepting the lock-up it states`,
      weekly: (n) => `Renew or extend one cover once during the window and read ${n}'s claims record before renewing, so the spend stays deliberate`,
    },
  },
  {
    match: ['prediction'],
    book: {
      open: (n, c, k) => `Fund the wallet with $${k} on ${c} and take one position in a liquid market on ${n} that you have a genuine view on`,
      deepen: (n, c, k) => `Take a second position in a different market category on ${n}, keeping each position under a third of the funded amount`,
      weekly: (n) => `Trade once a week in a new market rather than churning one book: breadth across markets is what ${n} can see`,
    },
  },
];

const GENERIC: Playbook = {
  open: (n, c, k) => `Deposit $${k} of USDC into ${n} on ${c} through its own app and keep the position open`,
  deepen: (n, c, k) => `Use a second feature of ${n} with about $${Math.round(k / 2)} (a second pool, vault or market), so the wallet is more than a single deposit`,
  weekly: (n) => `Make one small qualifying action a week (a deposit, a claim or a vote) so ${n} sees continuing use, not a one-day visit`,
};

function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) if (entry.match.some((m) => c.includes(m))) return entry.book;
  return GENERIC;
}

/**
 * A protocol's farm plan: seven steps generated from its own record. Every step names the
 * action, what it costs and how long it takes, and the plan as a whole stays inside the
 * gate's 20 to 600 characters a step.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  /* A bridge is farmed toward a destination: the first listed chain that is not Ethereum,
     so the plan never reads as bridging funds "to Ethereum" from Ethereum. */
  const isBridge = (p.category ?? '').toLowerCase().includes('bridge');
  const actionChain = isBridge ? (p.chains.find((c) => c !== 'Ethereum') ?? chain) : chain;
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const weeks = holdWeeksFor(age);
  const book = playbookFor(p.category);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const steps = [
    `Set up a fresh wallet for ${p.name} alone and fund it on ${chain} with the position capital plus ${gas.asset} for gas. Cost: ${gas.low} to ${gas.high} a transaction on ${chain}. Time: 10 minutes.`,
    `${book.open(p.name, actionChain, capital)}. Cost: $${capital} of capital plus one transaction fee. Time: 15 minutes to set up.`,
    `${book.deepen(p.name, actionChain, capital)}. Cost: the added capital stated, plus one transaction fee. Time: 15 minutes.`,
    secondChain !== null
      ? `Repeat the core position with $50 on ${secondChain}, ${p.name}'s second chain, so the wallet's record is not confined to one network. Cost: $50 of capital plus bridging and gas of about $2. Time: 20 minutes.`
      : `Deepen the ${chain} position by $50 after the first week rather than opening at full size on day one. Cost: $50 of added capital plus one transaction fee. Time: 10 minutes.`,
    `${book.weekly(p.name)}. Cost: about $2 of gas a week at ${chain} prices. Time: 10 minutes a week.`,
    `Hold every position for at least ${weeks} weeks and act in at least ${weeks} separate weeks: one burst of activity in a single week is the pattern points programs discount. Cost: the capital stays committed for the window. Time: ${weeks} weeks.`,
    `Keep a farm log (wallet, dates, transaction hashes, amounts) and check it weekly; when you finish, withdraw through ${p.name}'s own app only, and never pay a fee to claim a token: a claim that asks for one is a scam. Cost: nothing to log, standard gas to exit. Time: 5 minutes a week.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board more than once';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `${r.slug} outranks the row above it on implied value`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
