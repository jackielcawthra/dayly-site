/* Search, entirely in the browser.
 *
 * A static site has nowhere to run a query, so the index is fetched once and everything
 * happens here. No library: a scorer for 132 documents is thirty lines, and pulling in
 * Lunr or Fuse would mean either a third-party host — which nothing on this site is
 * allowed to touch — or 25 KB of someone else's code to do less than this does.
 *
 * The index loads lazily on first use. Somebody who never searches never pays for it.
 */
(function () {
  var idx = null, loading = null, idf = null;

  /* How much each word is worth, from how rare it is.
   *
   * Without this, "how much does it cost" ranked an article on raising responsible
   * children above the pricing page — because "much" appears in one of its headings
   * ("what matters much less than people think") and a heading match scored the same
   * whatever the word was. "Much" tells you nothing about what a page is about. "Cost"
   * tells you almost everything.
   *
   * This is inverse document frequency, and it costs no bytes: the index already
   * contains every page's vocabulary, so the frequencies can be counted here on load
   * rather than shipped.
   */
  function buildIdf(docs) {
    var df = Object.create(null), i, j, ws, seen;
    for (i = 0; i < docs.length; i++) {
      seen = Object.create(null);
      ws = (docs[i].t + ' ' + docs[i].h + ' ' + docs[i].d + ' ' + (docs[i].k || ''))
        .toLowerCase().split(/[^\p{L}\p{N}]+/u);
      for (j = 0; j < ws.length; j++) {
        if (ws[j] && !seen[ws[j]]) { seen[ws[j]] = 1; df[ws[j]] = (df[ws[j]] || 0) + 1; }
      }
    }
    var N = docs.length, out = Object.create(null);
    for (var w in df) {
      // Clamped: a word on every page is not worthless, and a word on one page is not
      // infinitely valuable. Between a third and roughly triple.
      out[w] = Math.max(0.35, Math.min(3, Math.log(N / df[w]) / Math.log(6)));
    }
    return out;
  }
  function weight(w) { return (idf && idf[w] !== undefined) ? idf[w] : 1.6; }

  function load() {
    if (idx) return Promise.resolve(idx);
    if (!loading) loading = fetch('/dayly-site/search-index.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { idx = d; idf = buildIdf(d); return d; });
    return loading;
  }

  /* Function words, dropped before anything is scored.
   *
   * The first version of this list was too short — it kept "much", and "how much does it
   * cost" came back with an article about homework, because "much" was rare enough in a
   * corpus of 132 pages to look meaningful and the pricing page happens never to use it.
   *
   * Rarity is the wrong instrument for this. In a small, topical corpus a genuinely
   * empty word can be rare and a central one ("mental", "load") can be everywhere. So
   * function words are named outright, as every search engine names them, and rarity is
   * left to do the job it is good at — weighting the words that remain.
   */
  var STOP = {};
  ('a an the and or but if then than that this these those of to in for on at by with from as ' +
   'is are was were be been being am it its my me i we our us you your he she his her him they ' +
   'them their there here what which who whom whose when where why how all any both each few ' +
   'more most much many other some such no nor not only own same so too very can could will ' +
   'would shall should may might must do does did done doing have has had having get gets got ' +
   'make makes made about after before between during without within because while against ' +
   'above below up down out off through further again once into over under also just now')
    .split(' ').forEach(function (w) { STOP[w] = 1; });

  /* Words a visitor uses for things this site calls something else.
   *
   * Somebody types "how much does it cost"; the pricing page says "price" throughout and
   * never says "cost", so it did not appear. This is not a ranking problem to be tuned
   * away — the two words mean the same thing and only one of them is ours.
   *
   * Kept deliberately short. Every entry here is a claim that two words are
   * interchangeable, which is often false, and a long synonym list is how a search box
   * starts returning confident nonsense. Each pair below is one somebody would actually
   * type, in British or American English, or as a parent rather than as a product.
   */
  var SYN = {
    // 'free' and 'cheap' were in here and immediately proved the warning above: "how
    // much does it cost" started returning a free tool, because free is a price and not
    // a synonym for one.
    cost:['price','pricing'], price:['cost','pricing'], pricing:['price','cost'],
    kid:['child','children'], kids:['children','child'], child:['kids','children'],
    children:['kids','child'], teen:['teenager','adolescent'], teenager:['teen'],
    chore:['job','chores','housework'], chores:['jobs','chore','housework'],
    job:['chore','chores'], jobs:['chores','chore'],
    mum:['mother','mom','parent'], mom:['mother','mum','parent'], mother:['mum','mom'],
    dad:['father','parent'], father:['dad'],
    vacation:['holiday'], holiday:['vacation','trip'], trip:['holiday','travel'],
    schedule:['calendar','routine','timetable'], calendar:['schedule','diary'],
    timetable:['schedule','calendar'], diary:['calendar'],
    homework:['schoolwork'], tidy:['clean','tidying'], clean:['tidy','cleaning'],
    overwhelmed:['overwhelm','burnout','exhausted'], burnout:['overwhelmed','exhausted'],
    reminder:['remind','reminders'], remind:['reminder','reminders'],
    organise:['organize','organisation'], organize:['organise','organisation'],
    app:['application','tool'], sync:['share','shared']
  };

  var BUYING = /\b(cost|costs|price|pricing|plan|plans|subscription|subscribe|trial|buy|pay|paid|refund|cancel|discount|free)\b/i;

  function terms(q) {
    return q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 1 && !STOP[w]; });
  }

  /* Fields are weighted by how much a match in them means. A word in the title is a
     strong signal about what the page is; the same word in the opening paragraph is a
     weak one. A phrase match beats any number of separate word matches, because someone
     typing "mental load" wants the page about the mental load and not every page that
     mentions loading a dishwasher. */
  function score(doc, ws, raw) {
    var t = doc.t.toLowerCase(), d = doc.d.toLowerCase(),
        h = doc.h.toLowerCase(), x = doc.x.toLowerCase(), k = doc.k || '';
    var s = 0, allHits = 0, infoHits = 0, infoNeed = 0, strong = 0;

    for (var i = 0; i < ws.length; i++) {
      var w = ws[i], got = 0, isStrong = 0, iw = weight(w);
      var informative = iw >= 0.8;
      if (informative) infoNeed++;

      if (t.indexOf(w) > -1) { s += (t.split(/\s+/).indexOf(w) === 0 ? 26 : 18) * iw; got = 1; isStrong = 1; }
      if (h.indexOf(w) > -1) { s += 7 * iw; got = 1; isStrong = 1; }
      if (d.indexOf(w) > -1) { s += 5 * iw; got = 1; isStrong = 1; }
      if (x.indexOf(w) > -1) { s += 2 * iw; got = 1; }
      // Anywhere else on the page. Worth almost nothing for ranking and everything for
      // recall: this is the field that stops a real word returning nothing at all.
      if (!got && k.indexOf(w) > -1) { s += 1; got = 1; }

      /* Still nothing? Try what else the visitor might have meant. Scored well below a
         real match, because a synonym is a guess and a page that uses the reader's own
         word should always win. */
      if (!got) {
        var alts = SYN[w] || [], hay = t + ' ' + h + ' ' + d;
        for (var a = 0; a < alts.length; a++) {
          if (hay.indexOf(alts[a]) > -1) { s += 6; got = 1; isStrong = 1; break; }
          if (k.indexOf(alts[a]) > -1) { s += 1; got = 1; break; }
        }
      }

      if (got) { allHits++; if (informative) infoHits++; }
      strong += isStrong;
    }

    /* Which words a page is actually required to contain.
     *
     * Not all of them, and this took three attempts. "How much does it cost" survives
     * the stop-word list as ["much", "cost"]. Requiring both excluded the pricing page
     * outright — it has a great deal to say about cost and never uses the word "much" —
     * so the question returned an article on raising responsible children, which happens
     * to contain both words.
     *
     * A longer stop-word list is not the answer; there is always another "much". A word
     * is required only when it is informative, and rarity is what informative means.
     *
     * The trap on the way: judging rarity against this site rather than against English.
     * "Mental" and "load" are on most pages here, so treating common-on-this-site as
     * uninformative made the site's own central subject unsearchable. Hence the fallback
     * — when a query contains no rare words at all, every word is required again.
     */
    if (infoNeed > 0) {
      var need = ws.length > 4 ? Math.ceil(infoNeed * 0.7) : infoNeed;
      if (infoHits < need) return 0;
    } else if (allHits < ws.length) {
      return 0;
    }

    /* A page that merely contains the words somewhere is not an answer. Whole-page
       vocabulary fixed recall and would have wrecked ranking: a document with no match
       in its title, headings or description now sits below every document that has one.
       It stays in the results — that is the point of indexing it — but it stops
       pretending to be the answer. */
    if (!strong) s = Math.min(s, 6);

    s += (allHits / ws.length) * 12 + strong * 3;

    if (ws.length > 1) {
      var phrase = raw.toLowerCase();
      if (t.indexOf(phrase) > -1) s += 40;
      else if (h.indexOf(phrase) > -1 || d.indexOf(phrase) > -1) s += 16;
      else if (x.indexOf(phrase) > -1) s += 8;
    }
    if (doc.c === 'Guide') s += 2;      // most searches here are looking for an article

    /* Except when they are not. Somebody typing "cost", "plan" or "free trial" is asking
       a commercial question, and answering it with an essay is unhelpful however well
       the essay matches. "How much does it cost" reduces to ["cost"], and two thoughtful
       Guide articles about the cost of things were beating the pricing page. */
    if (BUYING.test(raw) && (doc.c === 'Product' || doc.c === 'Comparison')) s += 14;
    return s;
  }

  function search(q) {
    var ws = terms(q);
    if (!ws.length || !idx) return [];
    var out = [];
    for (var i = 0; i < idx.length; i++) {
      var s = score(idx[i], ws, q);
      if (s > 0) out.push({ d: idx[i], s: s });
    }
    out.sort(function (a, b) { return b.s - a.s || a.d.t.length - b.d.t.length; });
    return out.slice(0, 24);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* Show the part of the opening that contains the search, not the first 140 characters
     of every page — otherwise every result looks the same. */
  function snippet(doc, ws) {
    var x = doc.x, low = x.toLowerCase(), at = -1;
    for (var i = 0; i < ws.length && at < 0; i++) at = low.indexOf(ws[i]);
    var from = at > 90 ? x.lastIndexOf(' ', at - 70) + 1 : 0;
    var cut = x.slice(from, from + 165);
    var html = esc((from ? '…' : '') + cut + (from + 165 < x.length ? '…' : ''));
    ws.forEach(function (w) {
      html = html.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
    });
    return html;
  }

  function render(box, results, q) {
    if (!q.trim()) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    if (!results.length) {
      box.innerHTML = '<p class="sr-none">Nothing matches <strong>' + esc(q) + '</strong>. ' +
        'Try a shorter phrase, or <a href="/dayly-site/guide/">browse the Guide</a>.</p>';
      return;
    }
    var ws = terms(q);
    box.innerHTML = '<ul class="sr-list">' + results.map(function (r, i) {
      return '<li><a href="' + r.d.u + '" data-i="' + i + '">' +
        '<span class="sr-cat">' + esc(r.d.c) + '</span>' +
        '<span class="sr-t">' + esc(r.d.t) + '</span>' +
        '<span class="sr-x">' + snippet(r.d, ws) + '</span></a></li>';
    }).join('') + '</ul>';
  }

  function wire(input, box) {
    var timer, last = '';
    function run() {
      var q = input.value;
      if (q === last) return;
      last = q;
      if (!q.trim()) { render(box, [], q); return; }
      load().then(function () { render(box, search(q), q); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 90); });
    input.addEventListener('focus', load);

    // Up, down, enter — so it can be used without reaching for the mouse.
    input.addEventListener('keydown', function (e) {
      var links = box.querySelectorAll('.sr-list a');
      if (!links.length) return;
      var cur = box.querySelector('.on'), i = cur ? +cur.dataset.i : -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        i = e.key === 'ArrowDown' ? Math.min(i + 1, links.length - 1) : Math.max(i - 1, 0);
        if (cur) cur.classList.remove('on');
        links[i].classList.add('on');
        links[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && cur) {
        e.preventDefault(); window.location = cur.getAttribute('href');
      } else if (e.key === 'Escape') {
        input.value = ''; render(box, [], '');
      }
    });
  }

  window.DaylySearch = { wire: wire, load: load, search: search };

  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('q'), box = document.getElementById('results');
    if (!input || !box) return;
    wire(input, box);
    // /search/?q=… so a result can be linked to, and so the browser's own search
    // suggestions can point here.
    var pre = new URLSearchParams(location.search).get('q');
    if (pre) { input.value = pre; load().then(function () { render(box, search(pre), pre); }); }
    input.focus();
  });
})();
