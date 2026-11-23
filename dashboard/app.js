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
  return (
    '<section class="model-strip"><h2>How the model prices a launch</h2>' +
    '<p><span class="formula">implied value = TVL × category multiple × momentum × maturity × breadth.</span> ' +
    'The multiple is the median market-cap-to-TVL ratio of traded tokens in the protocol\'s own category ' +
    '(global median <strong>' + Number(D.global_multiple).toFixed(3) + '×</strong> across ' + D.live_size + ' comparables), ' +
    'shrunk toward the global figure where a category is thin. Momentum scales it by the 7-day TVL change (clamped), ' +
    'maturity by how long the protocol has run with no token, breadth by the chains it serves. ' +
    'No protocol name is special-cased, and a protocol whose token already trades is never ranked: it sits in the comparables.</p></section>'
  );
}

function tabs(active) {
  return (
    '<nav class="tabs">' +
    '<button class="tab" data-nav="board" aria-selected="' + (active === 'board') + '">The board</button>' +
    '<button class="tab" data-nav="live" aria-selected="' + (active === 'live') + '">Already trading — the comparables</button>' +
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
    '<tr><td>Momentum (7d TVL ' + (r.change_7d == null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d + '%') + ')</td><td>' + factor(m.momentum) + '</td></tr>' +
    '<tr><td>Maturity (' + ageText(r.age_days) + ' with no token)</td><td>' + factor(m.maturity) + '</td></tr>' +
    '<tr><td>Breadth (' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ')</td><td>' + factor(m.breadth) + '</td></tr>' +
    '<tr><td>Implied value</td><td class="num">' + money(val) + '</td></tr></table>' +
    '<p>Range uses the category\'s p25 (' + Number(m.multiple_low).toFixed(3) + '×) and p75 (' + Number(m.multiple_high).toFixed(3) + '×) multiples in place of the median, all other factors unchanged.</p></section>' +
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

/* ---------- routing ---------- */

function render() {
  var parsed = parseHash();
  var html;
  if (parsed.path.indexOf('p/') === 0) html = detailView(decodeURIComponent(parsed.path.slice(2)));
  else if (parsed.path === 'live') html = liveView();
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
      location.hash = el.getAttribute('data-nav') === 'live' ? '#/live' : '#/';
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
