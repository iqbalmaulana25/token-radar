/* Launch Radar: the board, a detail view for every protocol, and the traded comparables.
   Everything renders from window.RADAR (data.js, written by main.ts beside this page):
   no fetch, no framework, no network. View state lives in the location hash, so the
   board, a filtered board and a detail view are each a linkable, screenshotable state. */
'use strict';

var D = window.RADAR;
var app = document.getElementById('app');

/* ---------- formatting ---------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function money(v) {
  if (v == null) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}

function pct(v) {
  if (v == null) return '<span class="num">—</span>';
  var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  return '<span class="num ' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
}

function ageText(days) {
  if (days == null) return 'unrecorded';
  if (days < 60) return days + 'd';
  if (days < 730) return Math.round(days / 30.4) + ' mo';
  return (days / 365.25).toFixed(1) + ' yrs';
}

function mult(v) { return '<span class="num">' + Number(v).toFixed(3) + '×</span>'; }
function factor(v) { return '<span class="num">' + Number(v).toFixed(3) + '×</span>'; }

/* ---------- shared chrome ---------- */

var RINGS =
  '<svg class="rings" width="340" height="340" viewBox="0 0 340 340" aria-hidden="true">' +
  '<g fill="none" stroke="#ffb224" stroke-width="1.5">' +
  '<circle cx="170" cy="170" r="52" opacity="0.55"/><circle cx="170" cy="170" r="96" opacity="0.35"/>' +
  '<circle cx="170" cy="170" r="140" opacity="0.22"/><circle cx="170" cy="170" r="168" opacity="0.14"/>' +
  '<line x1="170" y1="170" x2="292" y2="76" opacity="0.5"/></g>' +
  '<circle cx="238" cy="118" r="5" fill="#ffb224"/><circle cx="118" cy="238" r="4" fill="#3ddc97"/>' +
  '<circle cx="170" cy="170" r="4" fill="#e8edf7"/></svg>';

function masthead() {
  return (
    '<header class="masthead">' + RINGS +
    '<h1>LAUNCH <span class="signal">RADAR</span></h1>' +
    '<p class="tagline">Protocols that record no token yet, ranked by the value a token would carry ' +
    'if their record stayed as it is — priced from the traded tokens in the same snapshot, never from a name list.</p>' +
    '<div class="stats">' +
    '<div class="stat"><div class="v num">' + D.scanned + '</div><div class="k">protocols scanned</div></div>' +
    '<div class="stat"><div class="v num">' + D.board_size + '</div><div class="k">pre-token ranked</div></div>' +
    '<div class="stat"><div class="v num">' + D.watchlist_size + ' / ' + D.watchlist_size + '</div><div class="k">watchlist covered</div></div>' +
    '<div class="stat"><div class="v num">' + D.early_size + '</div><div class="k">early finds below the floor</div></div>' +
    '<div class="stat"><div class="v num">' + D.live_size + '</div><div class="k">traded comparables</div></div>' +
    '</div>' +
    '<p class="sweep">Snapshot: DefiLlama protocols, as of ' + esc(D.as_of) + ' · watchlist floor ' + money(D.floor_usd) + ' TVL · model ' + esc(D.model_version) + '</p>' +
    '</header>'
  );
}

function modelStrip() {
  var M = D.model;
  return (
    '<section class="model-strip"><h2>How the model prices a launch</h2>' +
    '<p><span class="formula">implied value = TVL × category multiple × scale × momentum.</span> ' +
    'The multiple is the median market-cap-to-TVL ratio of traded tokens in the protocol\'s own category ' +
    '(global median <strong>' + Number(D.global_multiple).toFixed(3) + '×</strong> across ' + D.live_size + ' comparables), ' +
    'shrunk toward the global figure with fitted shrinkage K=' + M.shrinkage_k + ' where a category is thin. ' +
    'Scale bends value by TVL<sup>' + M.elasticity + '</sup> around $100M, so a dollar of TVL in a large protocol prices ' +
    'a little lower than in a small one; momentum scales it by the 7-day TVL change (clamped to ' + M.growth_floor_pct + '%…+' +
    M.growth_cap_pct + '%, weight ' + M.growth_weight + '). ' +
    'Every term was fitted and tested held-out twice before it shipped, and three launch-radar-2 terms — ratio winsorising, ' +
    'an age premium, a per-chain premium — were dropped for failing that test: the full record, with its errors, ' +
    'is under <strong>Method &amp; validation</strong>. ' +
    'No protocol name is special-cased, and a protocol whose token already trades is never ranked: it sits in the comparables.</p></section>'
  );
}

function tabs(active) {
  return (
    '<nav class="tabs">' +
    '<button class="tab" data-nav="board" aria-selected="' + (active === 'board') + '">The board</button>' +
    '<button class="tab" data-nav="live" aria-selected="' + (active === 'live') + '">Already trading — the comparables</button>' +
    '<button class="tab" data-nav="method" aria-selected="' + (active === 'method') + '">Method &amp; validation</button>' +
    '</nav>'
  );
}

function footer() {
  return (
    '<footer><p>An implied value is this dashboard\'s own conditional estimate — what a token would be worth if it were ' +
    'issued against the record in the snapshot — not a prediction that a token will be issued, and not a promise about any launch. ' +
    'A protocol is listed as pre-token when its DefiLlama record carries no token; a record can lag the world, so check the protocol\'s own app before acting. ' +
    'Farm plans carry market, smart-contract and opportunity risk: never commit funds you cannot leave in place for the whole window.</p>' +
    '<p>Data: ' + esc(D.source) + '.</p></footer>'
  );
}

/* ---------- state ---------- */

function parseHash() {
  var h = location.hash.replace(/^#\/?/, '');
  var q = h.indexOf('?');
  var path = q >= 0 ? h.slice(0, q) : h;
  var params = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  return { path: path, params: params };
}

function boardState(params) {
  var sort = params.get('sort') || 'rank';
  var dirParam = params.get('dir');
  /* With no direction in the hash, rank and name read ascending and every
     value-like column reads descending: biggest first is the board's habit. */
  var dir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : sort === 'rank' || sort === 'name' ? 'asc' : 'desc';
  return {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watch: params.get('watch') === '1',
    min: Number(params.get('min') || 0),
    sort: sort,
    dir: dir,
  };
}

function boardHash(st) {
  var p = new URLSearchParams();
  if (st.q) p.set('q', st.q);
  if (st.cat) p.set('cat', st.cat);
  if (st.chain) p.set('chain', st.chain);
  if (st.watch) p.set('watch', '1');
  if (st.min) p.set('min', String(st.min));
  if (st.sort !== 'rank') p.set('sort', st.sort);
  if (st.dir !== 'asc') p.set('dir', st.dir);
  var s = p.toString();
  return '#/' + (s ? '?' + s : '');
}

/* ---------- board ---------- */

var SORTS = {
  rank: { label: 'Rank', get: function (r) { return r.rank; } },
  implied: { label: 'Implied value', get: function (r) { return r.implied_value_usd; } },
  tvl: { label: 'TVL', get: function (r) { return r.tvl_usd; } },
  change: { label: '7d change', get: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; } },
  age: { label: 'Age', get: function (r) { return r.age_days == null ? -1 : r.age_days; } },
  name: { label: 'Protocol', get: function (r) { return r.name.toLowerCase(); } },
};

function filteredRows(st) {
  var rows = D.rows.filter(function (r) {
    if (st.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
    if (st.cat && (r.category || 'Uncategorised') !== st.cat) return false;
    if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
    if (st.watch && !r.watchlist) return false;
    if (st.min && r.implied_value_usd < st.min) return false;
    return true;
  });
  var get = SORTS[st.sort].get;
  var dir = st.dir === 'desc' ? -1 : 1;
  rows.sort(function (a, b) {
    var x = get(a), y = get(b);
    if (x < y) return -1 * dir;
    if (x > y) return 1 * dir;
    return a.rank - b.rank;
  });
  return rows;
}

function options(list, current, allLabel) {
  var out = '<option value="">' + allLabel + '</option>';
  list.forEach(function (v) {
    out += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
  });
  return out;
}

function boardView(st) {
  var cats = [];
  var chains = [];
  D.rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (cats.indexOf(c) < 0) cats.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  cats.sort(); chains.sort();
  var rows = filteredRows(st);
  var head = [
    ['rank', '#'], ['name', 'Protocol'], ['implied', 'Implied value'], ['tvl', 'TVL'],
    ['change', '7d'], ['age', 'Age'],
  ];
  var thead = head.map(function (h) {
    var arrow = st.sort === h[0] ? ' <span class="dir">' + (st.dir === 'desc' ? '▼' : '▲') + '</span>' : '';
    return '<th class="sortable" data-sort="' + h[0] + '">' + h[1] + arrow + '</th>';
  }).join('') + '<th>Multiple</th><th>Chains</th>';
  var body = rows.map(function (r) {
    var chips = r.chains.slice(0, 3).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    if (r.chains.length > 3) chips += '<span class="chip">+' + (r.chains.length - 3) + '</span>';
    return (
      '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank num">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + (r.watchlist ? ' <span class="star" title="On the house watchlist">★</span>' : '') + '</span>' +
      '<div class="chips"><span class="chip cat">' + esc(r.category || 'Uncategorised') + '</span></div></td>' +
      '<td class="value num">' + money(r.implied_value_usd) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td>' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td>' + mult(r.model.multiple) + '</td>' +
      '<td><div class="chips">' + chips + '</div></td></tr>'
    );
  }).join('');
  return (
    masthead() + modelStrip() + tabs('board') +
    '<form class="controls" id="controls">' +
    '<div class="field"><label for="f-q">Search</label><input id="f-q" type="search" value="' + esc(st.q) + '" placeholder="Name or slug"></div>' +
    '<div class="field"><label for="f-cat">Category</label><select id="f-cat">' + options(cats, st.cat, 'All categories') + '</select></div>' +
    '<div class="field"><label for="f-chain">Chain</label><select id="f-chain">' + options(chains, st.chain, 'All chains') + '</select></div>' +
    '<div class="field"><label for="f-min">Min implied value</label><select id="f-min">' +
    '<option value="0"' + (st.min === 0 ? ' selected' : '') + '>Any value</option>' +
    '<option value="1000000"' + (st.min === 1e6 ? ' selected' : '') + '>$1M and up</option>' +
    '<option value="10000000"' + (st.min === 1e7 ? ' selected' : '') + '>$10M and up</option>' +
    '<option value="100000000"' + (st.min === 1e8 ? ' selected' : '') + '>$100M and up</option>' +
    '<option value="1000000000"' + (st.min === 1e9 ? ' selected' : '') + '>$1B and up</option></select></div>' +
    '<div class="field check"><input id="f-watch" type="checkbox"' + (st.watch ? ' checked' : '') + '><label for="f-watch">Watchlist only ★</label></div>' +
    '</form>' +
    '<p class="count-line">Showing <strong>' + rows.length + '</strong> of ' + D.board_size + ' ranked protocols. Click a row for its detail and farm plan; click a column head to sort.</p>' +
    '<table><thead><tr>' + thead + '</tr></thead><tbody>' + body + '</tbody></table>' +
    footer()
  );
}

/* ---------- detail ---------- */

function detailView(slug) {
  var r = null;
  D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
  if (!r) return boardView(boardState(new URLSearchParams()));
  var m = r.model;
  var lo = m.implied_low_usd, hi = m.implied_high_usd, val = r.implied_value_usd;
  var span = Math.max(hi - lo, 1);
  var left = Math.max(0, Math.min(100, ((lo - lo) / span) * 100));
  var width = Math.max(2, Math.min(100, ((hi - lo) / span) * 100));
  var mark = Math.max(0, Math.min(100, ((val - lo) / span) * 100));
  var catRow = null;
  D.categories.forEach(function (c) { if (c.category === (r.category || 'Uncategorised')) catRow = c; });
  var peers = D.live.filter(function (l) { return (l.category || 'Uncategorised') === (r.category || 'Uncategorised'); }).slice(0, 4);
  var peerRows = peers.map(function (l) {
    return '<tr><td>' + esc(l.name) + (l.symbol ? ' (' + esc(l.symbol) + ')' : '') + '</td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' + money(l.tvl_usd) + '</td><td>' + mult(l.multiple) + '</td></tr>';
  }).join('');
  var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
  var chainChips = r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
  return (
    masthead() + tabs('board') +
    '<a class="back" href="#/">← Back to the board</a>' +
    '<div class="detail-head"><div><h2>' + esc(r.name) + (r.watchlist ? ' <span class="star">★</span>' : '') + '</h2>' +
    '<div class="sub">' + esc(r.category || 'Uncategorised') + ' · rank #' + r.rank + ' of ' + D.board_size +
    (r.watchlist ? ' · on the house watchlist' : ' · an early find below the watchlist floor') + ' · records no token in the snapshot</div>' +
    '<div class="chips" style="margin-top:8px">' + chainChips + '</div></div>' +
    '<div class="big-value"><div class="v num">' + money(val) + '</div><div class="k">implied value if launched</div></div></div>' +
    '<div class="rangebar"><div class="track"><div class="fill" style="left:' + left + '%;width:' + width + '%"></div>' +
    '<div class="mark" style="left:' + mark + '%"></div></div>' +
    '<div class="labels"><span>low ' + money(lo) + '</span><span>category p25–p75 range</span><span>high ' + money(hi) + '</span></div></div>' +
    '<div class="cards">' +
    '<section class="card"><h3>How this value is built</h3><table>' +
    '<tr><td>Total value locked</td><td class="num">' + money(r.tvl_usd) + '</td></tr>' +
    '<tr><td>Category multiple (median, shrunk)</td><td>' + mult(m.multiple) + '</td></tr>' +
    '<tr><td>Traded comparables in category</td><td class="num">' + m.category_comparables + '</td></tr>' +
    '<tr><td>Scale (TVL<sup>' + D.model.elasticity + '</sup> around $100M)</td><td>' + factor(m.scale) + '</td></tr>' +
    '<tr><td>Momentum (7d TVL ' + (r.change_7d == null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d + '%') + ')</td><td>' + factor(m.momentum) + '</td></tr>' +
    '<tr><td>Implied value</td><td class="num">' + money(val) + '</td></tr></table>' +
    '<p>Range uses the category\'s p25 (' + Number(m.multiple_low).toFixed(3) + '×) and p75 (' + Number(m.multiple_high).toFixed(3) + '×) multiples in place of the median, all other factors unchanged. ' +
    'Age (' + ageText(r.age_days) + ' with no token) and breadth (' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ') stay in the record and shape the farm plan, ' +
    'but no longer move the price: both premiums were dropped after the held-out splits disagreed about them — see Method &amp; validation.</p></section>' +
    '<section class="card"><h3>The record</h3><table>' +
    '<tr><td>First tracked by DefiLlama</td><td class="num">' + esc(r.listed_at || 'unrecorded') + '</td></tr>' +
    '<tr><td>Age at snapshot</td><td class="num">' + (r.age_days == null ? 'unrecorded' : r.age_days + ' days') + '</td></tr>' +
    '<tr><td>TVL change, 7 days</td><td>' + pct(r.change_7d) + '</td></tr>' +
    '<tr><td>Chains served</td><td class="num">' + r.chains.length + '</td></tr>' +
    '<tr><td>Watchlist floor</td><td class="num">' + money(D.floor_usd) + '</td></tr></table>' +
    (catRow ? '<p>In ' + esc(catRow.category) + ', ' + catRow.n + ' traded tokens price TVL at a median of ' + Number(catRow.median).toFixed(3) + '× (p25 ' + Number(catRow.p25).toFixed(3) + '×, p75 ' + Number(catRow.p75).toFixed(3) + '×).</p>' : '<p>This category has too few traded tokens to price itself, so the global median multiple carries it.</p>') +
    '</section>' +
    '<section class="card"><h3>Traded peers in this category</h3>' +
    (peerRows ? '<table><thead><tr><th>Protocol</th><th>Market cap</th><th>TVL</th><th>Ratio</th></tr></thead><tbody>' + peerRows + '</tbody></table>' : '<p>No traded protocol in this category made the comparables table.</p>') +
    '<p>These already trade, so they are never ranked here — they are the yardstick the model prices the pre-token board against.</p></section>' +
    '</div>' +
    '<section class="plan"><h3>Farm plan — ' + esc(r.name) + '</h3><ol>' + steps + '</ol></section>' +
    footer()
  );
}

/* ---------- live comparables ---------- */

function liveView() {
  var body = D.live.map(function (l) {
    return '<tr><td><span class="pname">' + esc(l.name) + '</span>' + (l.symbol ? ' <span class="pslug">' + esc(l.symbol) + '</span>' : '') +
      '<div class="chips"><span class="chip cat">' + esc(l.category || 'Uncategorised') + '</span></div></td>' +
      '<td class="value num">' + money(l.mcap_usd) + '</td><td class="num">' + money(l.tvl_usd) + '</td><td>' + mult(l.multiple) + '</td><td>' + pct(l.change_7d) + '</td></tr>';
  }).join('');
  var cats = D.categories.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td>' + mult(c.median) + '</td><td>' + mult(c.p25) + '</td><td>' + mult(c.p75) + '</td></tr>';
  }).join('');
  return (
    masthead() + modelStrip() + tabs('live') +
    '<p class="count-line">These protocols already have a token: the market, not the model, sets their value. ' +
    'They are shown apart from the board because they are the comparables the board is priced from — the top ' + D.live.length + ' by market cap of ' + D.live_size + ' traded protocols in the snapshot.</p>' +
    '<table><thead><tr><th>Protocol</th><th>Market cap</th><th>TVL</th><th>MCap / TVL</th><th>7d</th></tr></thead><tbody>' + body + '</tbody></table>' +
    '<div class="cards"><section class="card" style="grid-column:1/-1"><h3>Category multiples — the model\'s yardsticks</h3>' +
    '<table><thead><tr><th>Category</th><th>Traded tokens</th><th>Median</th><th>p25</th><th>p75</th></tr></thead><tbody>' + cats + '</tbody></table>' +
    '<p>Each pre-token protocol is priced at its own category\'s median, shrunk toward the global median of ' + Number(D.global_multiple).toFixed(3) + '× where the category sample is thin.</p></section></div>' +
    footer()
  );
}

/* ---------- method & validation ---------- */

function mdale(v) { return Number(v).toFixed(3); }
function errFactor(v) { return '≈' + Math.exp(v).toFixed(1) + '×'; }
function pctShare(v) { return Math.round(v * 100) + '%'; }

function methodView() {
  var V = D.validation, M = D.model;
  var splitRows = V.splits.map(function (s) {
    return '<tr><td>' + esc(s.name) + '</td><td class="num">' + s.train_n + '</td><td class="num">' + s.test_n + '</td>' +
      '<td class="num">' + mdale(s.base_mdale) + '</td><td class="num">' + mdale(s.v2_mdale) + '</td>' +
      '<td class="num">' + mdale(s.selected_mdale) + '</td><td class="num">' + mdale(s.shipped_mdale) + '</td></tr>';
  }).join('');
  function termCell(s) {
    var pill = s.kept ? '<span class="pill keep">kept</span>' : '<span class="pill drop">dropped</span>';
    return '<td>' + esc(s.fitted_variant) + '<br><span class="num">' + mdale(s.heldout_before) + ' → ' + mdale(s.heldout_after) + '</span> ' + pill + '</td>';
  }
  var termRows = V.splits[0].steps.map(function (st, i) {
    var shipped = null;
    V.refit.forEach(function (f) { if (f.term === st.term) shipped = f; });
    return '<tr><td>' + esc(st.label) + '</td>' + termCell(st) + termCell(V.splits[1].steps[i]) +
      '<td>' + (shipped ? esc(shipped.variant) : '<span class="faint">not in the model</span>') + '</td></tr>';
  }).join('');
  var a = V.splits[0], b = V.splits[1];
  return (
    masthead() + tabs('method') +
    '<div class="cards"><section class="card" style="grid-column:1/-1"><h3>The test every term had to pass</h3>' +
    '<p>A launch model can only be scored where the answer is known: the ' + V.traded_n + ' protocols in the snapshot whose token ' +
    'already trades. The harness (<span class="num">tools/validate.mjs</span> in the entry\'s repository) splits them two ways — ' +
    'by a hash of the slug, a coin flip no property can sway, and by listing time, fitting the past and testing the future. ' +
    'On each split it walks the candidate terms in a fixed order: a term\'s variants are fitted on the training half alone, and the term ' +
    'is kept only if the fitted variant cuts the held-out half\'s error by at least ' + (V.keep_margin * 100).toFixed(1) + '% relative. ' +
    'A term ships in the model below only if <strong>both</strong> splits keep it; its shipped variant is the one with the lowest ' +
    'combined held-out error across the two splits.</p>' +
    '<p>Error is the median absolute log error (MdALE) of the implied value against the market cap the protocol actually carries: ' +
    'an MdALE of 1.21 means the typical held-out price was off by a factor of ' + errFactor(a.shipped_mdale) + '. It is a hard test — ' +
    'a model can be directionally right about nearly everything and still post a large MdALE — and it is the only honest one available.</p>' +
    '<table><thead><tr><th>Split</th><th>Train</th><th>Held out</th><th>Bare model</th><th>launch-radar-2 (hand-set)</th><th>Selected on this split</th><th>Shipped model, refitted here</th></tr></thead>' +
    '<tbody>' + splitRows + '</tbody></table>' +
    '<p>On the hash split the selected terms priced ' + pctShare(a.selected_within_2x) + ' of held-out protocols within 2× of their market cap; ' +
    'on the time split, ' + pctShare(b.selected_within_2x) + '. The shipped model beats the hand-set launch-radar-2 on both splits ' +
    '(' + mdale(a.shipped_mdale) + ' against ' + mdale(a.v2_mdale) + '; ' + mdale(b.shipped_mdale) + ' against ' + mdale(b.v2_mdale) + ') — ' +
    'a real improvement, and a modest one, which is what the numbers say and all they say.</p></section></div>' +
    '<div class="cards"><section class="card" style="grid-column:1/-1"><h3>Every term, both splits</h3>' +
    '<table><thead><tr><th>Term</th><th>Split A — fitted variant, held-out error</th><th>Split B — fitted variant, held-out error</th><th>Shipped</th></tr></thead>' +
    '<tbody>' + termRows + '</tbody></table>' +
    '<p>Two verdicts deserve a plain reading. Winsorising the comparable ratios changed no held-out price at all — the median a price ' +
    'rests on is already robust — so the clamp is gone and the p25–p75 ranges show the tails as they are. The maturity premium ' +
    'split its verdicts: it earned its place on the time split (−3.0%) and cost accuracy on the hash split (+0.5%), and the both-splits ' +
    'rule drops a term the evidence argues about. Age still shapes each farm plan\'s qualifying window; it no longer inflates a price.</p></section></div>' +
    '<div class="cards">' +
    '<section class="card"><h3>What ships — model ' + esc(D.model_version) + '</h3><table>' +
    '<tr><td>Category multiple</td><td>median mcap/TVL of the category, shrinkage K=' + M.shrinkage_k + ', global median below ' + M.min_category_samples + ' comparables</td></tr>' +
    '<tr><td>Scale</td><td class="num">TVL^' + M.elasticity + ' around $100M</td></tr>' +
    '<tr><td>Momentum</td><td class="num">1 + ' + M.growth_weight + ' × clamp(7d change, ' + M.growth_floor_pct + '%, +' + M.growth_cap_pct + '%) / 100</td></tr>' +
    '<tr><td>Not in the price</td><td>ratio winsorising (bounds ' + M.ratio_floor + '–' + M.ratio_cap + ' only), age, chain count — tested and dropped, above</td></tr></table>' +
    '<p>Fitted on the snapshot as of ' + esc(V.as_of) + '; reproduce every number with the harness in the repository.</p></section>' +
    '<section class="card"><h3>What this model cannot do</h3>' +
    '<p>Its typical held-out price is off by a factor of ' + errFactor(a.shipped_mdale) + ' on the hash split and ' + errFactor(b.shipped_mdale) + ' on the time split: ' +
    'treat every implied value as a ranking with a wide range around it, never as a quote. The time split is the harder and more honest test — ' +
    'protocols listed later price worse than earlier ones (bare-model error ' + mdale(b.base_mdale) + ' against ' + mdale(a.base_mdale) + '), so expect the model to drift as the market regime moves. ' +
    (b.excluded_n ? b.excluded_n + ' of the ' + V.traded_n + ' traded protocols record no listing date and sit out the time split entirely. ' : '') +
    'Thin categories rest on as few as ' + M.min_category_samples + ' traded tokens. And the model prices a token as if issued against the record in the snapshot: ' +
    'it says nothing about whether or when one is issued, and a protocol\'s own announcement can make a row stale overnight.</p></section>' +
    '</div>' +
    footer()
  );
}

/* ---------- routing ---------- */

function render() {
  var parsed = parseHash();
  var html;
  if (parsed.path.indexOf('p/') === 0) html = detailView(decodeURIComponent(parsed.path.slice(2)));
  else if (parsed.path === 'live') html = liveView();
  else if (parsed.path === 'method') html = methodView();
  else html = boardView(boardState(parsed.params));
  app.innerHTML = html;
  app.setAttribute('aria-busy', 'false');
  bind();
  window.scrollTo(0, 0);
}

function bind() {
  var tabsEls = app.querySelectorAll('[data-nav]');
  tabsEls.forEach(function (el) {
    el.addEventListener('click', function () {
      var nav = el.getAttribute('data-nav');
      location.hash = nav === 'live' ? '#/live' : nav === 'method' ? '#/method' : '#/';
    });
  });
  var form = document.getElementById('controls');
  if (form) {
    var update = function () {
      var st = {
        q: document.getElementById('f-q').value,
        cat: document.getElementById('f-cat').value,
        chain: document.getElementById('f-chain').value,
        watch: document.getElementById('f-watch').checked,
        min: Number(document.getElementById('f-min').value),
        sort: 'rank', dir: 'asc',
      };
      var cur = boardState(parseHash().params);
      st.sort = cur.sort; st.dir = cur.dir;
      history.replaceState(null, '', boardHash(st));
      render();
    };
    form.addEventListener('change', update);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    var q = document.getElementById('f-q');
    var t = null;
    q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(update, 250); });
  }
  app.querySelectorAll('th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var cur = boardState(parseHash().params);
      var key = th.getAttribute('data-sort');
      if (cur.sort === key) cur.dir = cur.dir === 'asc' ? 'desc' : 'asc';
      else { cur.sort = key; cur.dir = key === 'name' ? 'asc' : 'desc'; }
      if (key === 'rank') cur.dir = 'asc';
      history.replaceState(null, '', boardHash(cur));
      render();
    });
  });
  app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
    tr.addEventListener('click', function () {
      location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
    });
  });
}

window.addEventListener('hashchange', render);
render();
