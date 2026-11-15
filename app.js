(function () {
'use strict';
var P = window.STEADY_PROMPTS, SEC = window.STEADY_SECTIONS, $app = document.getElementById('app');
var LS = localStorage, K = LS.getItem('steady.k'), API = LS.getItem('steady.api') || (window.STEADY_CONFIG || {}).API_URL || '';
function jget(k, d) { try { var v = JSON.parse(LS.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function jset(k, v) { try { LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { setTimeout(function () { toast('Phone storage is full. This was not saved.'); }, 0); return false; } }
var snap = jget('steady.snap', { config: {}, answers: [], entries: [], katya: [] }), queue = jget('steady.q', []), drafts = jget('steady.drafts', {}), ui = jget('steady.ui', { lastQ: 0 });
var sync = { state: API ? 'idle' : 'local', msg: '' };
var route = { tab: 'home' }, overlay = null;

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function nl(s) { return esc(s).replace(/\n/g, '<br>'); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function nowStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function day(s) { return String(s || '').slice(0, 10); }
function today() { return day(nowStr(NOW())); }
function daysAgo(s) { return Math.floor((new Date(today()) - new Date(day(s))) / 864e5); }
function niceDate(s) { var d = new Date(String(s).slice(0, 10) + 'T12:00:00'); if (isNaN(d)) return ''; var n = daysAgo(s); return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, d.getFullYear() === NOW().getFullYear() ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); }
function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.className = 'on'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 2200); }
function pick(arr, seed) { if (!arr.length) return null; var s = 0, str = seed || today(); for (var i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0; return arr[s % arr.length]; }

/* ---------- data (server snapshot + pending ops) ---------- */
function view() {
  var v = { config: Object.assign({}, snap.config), answers: snap.answers.slice(), entries: snap.entries.slice(), katya: snap.katya.slice() };
  queue.forEach(function (op) {
    if (op.t === 'answer' && !v.answers.some(function (a) { return a.id === op.id; })) v.answers.push({ id: op.id, at: op.at, q: op.q, text: op.text });
    if (op.t === 'entry') { v.entries = v.entries.filter(function (e) { return e.id !== op.eid; }); if (!op.del) v.entries.push({ id: op.eid, at: op.at, type: op.type, data: op.data }); }
    if (op.t === 'ask' && !v.katya.some(function (a) { return a.id === op.id; })) v.katya.push({ id: op.id, at: op.at, text: op.text, status: 'waiting to send', reply: '' });
  });
  return v;
}
var V;
function child() { return V.config.child || LS.getItem('steady.c') || 'your daughter'; }
function kids() { var k = (V.config.kids || LS.getItem('steady.kids') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); return k.length ? k : [child()]; }
function fill(s) { return String(s).replace(/\{c\}/g, child()); }
function ans(q) { var a = V.answers.filter(function (x) { return x.q === q; }); a.sort(function (x, y) { return x.at < y.at ? -1 : 1; }); return a; }
function latest(q) { var a = ans(q); return a.length ? a[a.length - 1].text : ''; }
function answered(q) { return !!latest(q).trim(); }
function items(q) {
  var t = latest(q).trim(); if (!t) return [];
  var parts = t.split(/\n+/); if (parts.length < 2) parts = t.split(/;|,\s+|\s+-\s+|\u2022/);
  return parts.map(function (x) { return x.replace(/^\s*(\d+[.)]|[-*\u2022])\s*/, '').trim(); }).filter(function (x) { return x.length > 1; });
}
function entries(type) { return V.entries.filter(function (e) { return e.type === type; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }); }
function push(op) { op.id = op.id || uid(); op.at = op.at || nowStr(); queue.push(op); jset('steady.q', queue); V = view(); flush(); }
function entry(type, data, eid) { push({ t: 'entry', type: type, data: data, eid: eid || uid() }); }
function delEntry(eid) { push({ t: 'entry', eid: eid, del: true, type: '', data: {} }); }
function saveAnswer(q, text) { if (text.trim() === latest(q).trim()) return false; push({ t: 'answer', q: q, text: text }); delete drafts[q]; jset('steady.drafts', drafts); return true; }

var flushing = false;
function flush(force) {
  if (!API || !K || flushing) { if (!API) sync.state = 'local'; return; }
  if (!queue.length && !force) return;
  flushing = true; var ops = queue.slice(); sync.state = 'syncing';
  fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store', body: JSON.stringify({ k: K, ops: ops }) })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) {
      if (!j.ok) throw new Error(j.error || 'error');
      snap = j.result; jset('steady.snap', snap);
      queue = queue.filter(function (o) { return ops.indexOf(o) < 0; }); jset('steady.q', queue);
      sync.state = 'ok'; sync.at = nowStr(); setTimeout(mediaFlush, 0);
    })
    .catch(function (e) { sync.state = 'offline'; sync.msg = String(e.message || e); })
    .then(function () { flushing = false; V = view(); var a = document.activeElement; if (!a || !/TEXTAREA|INPUT/.test(a.tagName)) render(); if (queue.length && sync.state === 'ok') flush(); });
}

/* ---------- shell ---------- */
function syncLine() {
  var n = queue.length;
  if (sync.state === 'local') return 'Saved on this phone only';
  if (sync.state === 'offline') return n ? 'Saved on this phone. Not synced yet.' : 'Saved. Not connected right now.';
  if (sync.state === 'syncing') return 'Saving privately\u2026';
  return 'Saved privately';
}
function go(tab) { route = { tab: ({ today: 'home', people: 'home', support: 'home', letters: 'home', moments: 'home' })[tab] || tab }; overlay = null; render(); window.scrollTo(0, 0); }
function open(fn) { overlay = fn; render(); window.scrollTo(0, 0); }
function close() { overlay = null; render(); window.scrollTo(0, 0); }

var handlers = {};
function on(name, fn) { handlers[name] = fn; }
function bindAll() {
  $app.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { go(b.dataset.tab); }; });
  $app.querySelectorAll('[data-do]').forEach(function (b) { b.onclick = function (ev) { ev.preventDefault(); var h = handlers[b.dataset.do]; if (h) h(b.dataset.arg, b); }; });
  var ta = $app.querySelector('textarea[data-q]');
  if (ta) { ta.oninput = function () { drafts[ta.dataset.q] = ta.value; jset('steady.drafts', drafts); var s = $app.querySelector('.saved'); if (s) s.textContent = 'Kept on this phone as you write'; }; }
}

/* ---------- onboarding / reflective intake ---------- */
function nextOpen(from) { for (var i = 1; i <= P.length; i++) { var q = (from + i) % P.length; if (!answered(q)) return q; } return -1; }
function doneCount() { var n = 0; for (var i = 0; i < P.length; i++) if (answered(i)) n++; return n; }
function vWelcome() {
  return '<div class="intro"><div class="sun big"></div><h1>Take your time.</h1>' +
    '<p>Seventeen questions to sit with, one at a time. No right answers, no deadline. Skip any of them and come back whenever you like.</p>' +
    '<p>Your answers shape the rest of the app. Only you can see them.</p>' +
    '<button class="btn primary" data-do="startIntake">Begin</button><button class="btn ghost" data-do="skipIntro">Look around first</button></div>';
}
on('startIntake', function () { ui.welcomed = true; jset('steady.ui', ui); openQ(answered(ui.lastQ || 0) ? Math.max(0, nextOpen(ui.lastQ || 0)) : (ui.lastQ || 0)); });
on('skipIntro', function () { ui.welcomed = true; jset('steady.ui', ui); close(); });

function openQ(q) { q = P[+q] ? +q : 0; ui.lastQ = q; jset('steady.ui', ui); open(function () { return vPrompt(q); }); }
function vPrompt(q) {
  var p = P[q], val = drafts[q] != null ? drafts[q] : latest(q), first = q === 0 || P[q - 1].s !== p.s, hist = ans(q);
  var ph = p.three ? '1.\n2.\n3.' : p.list ? 'One idea per line' : 'Whatever comes to mind\u2026';
  return '<div class="prompt">' +
    '<div class="ptop"><button class="link" data-do="pauseQ">\u2190 Pause</button><span>' + (q + 1) + ' of ' + P.length + '</span></div>' +
    '<p class="sec">' + esc(fill(SEC[p.s])) + '</p>' +
    '<h2 class="ptext">' + esc(fill(p.t)) + '</h2>' +
    '<details class="why"' + (first ? '' : '') + '><summary>Why this matters</summary><p>' + esc(fill(p.n)) + '</p></details>' +
    '<textarea data-q="' + q + '" rows="9" placeholder="' + esc(ph) + '">' + esc(val) + '</textarea>' +
    '<p class="saved">' + (hist.length ? 'Last saved ' + esc(niceDate(hist[hist.length - 1].at)) + '' : 'Not saved yet') + '</p>' +
    (hist.length > 1 ? '<details class="hist"><summary>Earlier answers (' + (hist.length - 1) + ')</summary>' + hist.slice(0, -1).reverse().map(function (x) { return '<div class="old"><p class="when">' + esc(niceDate(x.at)) + '</p><p>' + nl(x.text) + '</p></div>'; }).join('') + '</details>' : '') +
    '<button class="btn primary" data-do="saveNext" data-arg="' + q + '">Save and continue</button>' +
    '<div class="row2"><button class="btn ghost" data-do="prevQ" data-arg="' + q + '"' + (q === 0 ? ' disabled' : '') + '>Back</button><button class="btn ghost" data-do="skipQ" data-arg="' + q + '">Come back to this later</button></div>' +
    '</div>';
}
function curText() { var t = $app.querySelector('textarea[data-q]'); return t ? t.value : ''; }
on('saveNext', function (q) { q = +q; var t = curText(); if (saveAnswer(q, t)) toast('Saved'); if (q + 1 >= P.length) { var n = nextOpen(q); if (n < 0) { open(vAllDone); return; } openQ(n); } else openQ(q + 1); });
on('skipQ', function (q) { q = +q; var t = curText(); if (t.trim()) { drafts[q] = t; jset('steady.drafts', drafts); } if (q + 1 < P.length) openQ(q + 1); else { var n = nextOpen(q); n < 0 || n === q ? open(vAllDone) : openQ(n); } });
on('prevQ', function (q) { q = +q; var t = curText(); if (t.trim() && t !== latest(q)) { drafts[q] = t; jset('steady.drafts', drafts); } if (q > 0) openQ(q - 1); });
on('pauseQ', function () { var t = $app.querySelector('textarea[data-q]'); if (t && t.value.trim() && t.value !== latest(+t.dataset.q)) saveAnswer(+t.dataset.q, t.value); toast('Saved'); go(route.tab || 'home'); });
function vAllDone() { return '<div class="intro"><div class="sun big"></div><h1>That was a lot to sit with.</h1><p>Thank you for giving it the time. You can come back to any of these whenever you like. Your answers will look different in a few months, and that is good.</p><button class="btn primary" data-do="home">Go to Today</button></div>'; }
on('home', function () { go('home'); });

/* ---------- Today ---------- */
function greeting() { var h = NOW().getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function uniqText(arr, f) { var seen = {}; return arr.filter(function (x) { var k = String(f ? f(x) : x).trim().toLowerCase(); if (!k || seen[k]) return false; seen[k] = 1; return true; }); }
function credits() {
  var c = items(1).map(function (t) { return { t: t, src: 'You give them' }; });
  var p = latest(0).trim(); if (p) c.unshift({ t: p, src: 'What you are proud of' });
  entries('journal').filter(function (j) { return j.data.kind === 'pm'; }).slice(0, 20).forEach(function (j) {
    if (j.data.proud) c.push({ t: j.data.proud, src: 'Proud of \u00b7 ' + niceDate(j.at) }); if (j.data.gave) c.push({ t: j.data.gave, src: 'You gave them \u00b7 ' + niceDate(j.at) }); });
  entries('win').slice(0, 30).forEach(function (w) { c.push({ t: w.data.label, src: niceDate(w.at) }); });
  return uniqText(c, function (x) { return x.t; });
}
var WINS = ['Stayed calm', 'Gave space', 'Showed up', 'Made them laugh', 'Repaired after a hard moment', 'Held a limit kindly', 'Said I love you', 'Took care of myself'];
function winsToday() { return entries('win').filter(function (w) { return day(w.at) === today(); }); }
function oneOnOneIdeas() {
  var a = items(12).concat(items(11)), seen = {};
  a = a.filter(function (x) { var k = x.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
  return a.length ? a : ['A drive together, music of her choice', 'Get a treat, just the two of you', 'Walk around the block after dinner', 'Ask her to teach you something she likes', 'Sit with her while she does her thing'];
}
function careItems() { var a = []; var plan = entries('plan')[0]; if (plan) a = a.concat(plan.data.items || []); return a.concat(items(5), items(6)).filter(Boolean); }
on('resume', function () { var l = P[+ui.lastQ] ? +ui.lastQ : 0, q = drafts[l] != null || !answered(l) ? l : nextOpen(l); openQ(q < 0 ? 0 : q); });
on('win', function (label) { entry('win', { label: label }); toast('Saved'); render(); });
on('logOne', function () { route = { tab: 'moments', preset: { kid: child(), tag: 'One-on-one' } }; render(); });

/* ---------- In the moment ---------- */
var HELP = [
  ['quiet', '{c} is closed off', 'Give space without reading it as rejection'],
  ['limit', 'I need to hold a limit', 'Her feelings make sense. The boundary stays.'],
  ['messed', 'I think I messed up', 'Talk to yourself like someone you love'],
  ['racing', 'My mind is racing', 'Slow down, set it down, one small step']
];
on('help', function (k) { open(function () { return vHelp(k); }); });
function yours(q, label) { var t = latest(q).trim(); return t ? '<div class="yours"><p class="eyebrow">' + esc(label) + '</p><p>' + nl(t) + '</p></div>' : '<p class="small">Answer reflection ' + (q + 1) + ' and your own words will show up here. <a href="#" data-do="gotoQ" data-arg="' + q + '">Answer it</a></p>'; }
on('gotoQ', function (q) { openQ(+q); });
on('closeO', function () { close(); });
function vHelp(k) {
  var c = esc(child()), o = back();
  if (k === 'quiet') {
    o += '<h1>' + c + ' is closed off</h1><div class="breath">Her quiet is about what she\u2019s carrying, not about you.</div>' +
      '<div class="script"><p class="eyebrow">You could say</p><p class="serif">\u201cYou don\u2019t have to talk right now. I\u2019m here whenever you want.\u201d</p><p class="small">Then let it be. Stay nearby, keep it easy. Offer a snack or a ride, not a question.</p></div>' +
      yours(10, 'In your own words') + yours(8, 'What usually comes up in you') +
      yours(11, 'When she tends to open up');
  } else if (k === 'limit') {
    var f = ui.limitFeel || 'upset', l = ui.limitText || '';
    o += '<h1>Holding a limit</h1><p>She can be upset with a boundary and still feel deeply loved and understood within it.</p>' +
      '<label class="lbl">She seems\u2026</label><div class="chips">' + ['upset', 'frustrated', 'disappointed', 'left out', 'angry', 'embarrassed'].map(function (x) { return '<button class="chip' + (x === f ? ' on' : '') + '" data-do="feel" data-arg="' + x + '">' + x + '</button>'; }).join('') + '</div>' +
      '<label class="lbl" for="lim">The limit</label><input id="lim" value="' + esc(l) + '" placeholder="e.g. phones go in the kitchen at 9">' +
      '<button class="btn small" data-do="buildLimit">Make my script</button>' +
      '<div class="script"><p class="eyebrow">You could say</p><p class="serif">\u201cI can see you\u2019re really ' + esc(f) + ' about this, and that makes sense to me. ' + (l ? 'And ' + esc(l) + '.' : 'And the answer is still no.') + ' I love you, and I\u2019m right here.\u201d</p><p class="small">Say it once, calmly. You don\u2019t need her to agree. Her being upset doesn\u2019t mean you did it wrong.</p></div>' +
      yours(14, 'Your words for both messages') + yours(13, 'Validating without giving in');
  } else if (k === 'messed') {
    o += '<h1>You think you messed up</h1><div class="breath">Pause. Every father gets it wrong sometimes. What matters is coming back.</div>';
    var harsh = latest(2).trim();
    if (harsh) o += '<div class="yours"><p class="eyebrow">What you tend to tell yourself</p><p>' + nl(harsh) + '</p></div>';
    o += '<div class="script"><p class="eyebrow">What you\u2019d say to someone you love</p><p class="serif">' + esc(reframe()) + '</p></div>' +
      '<div class="script"><p class="eyebrow">A simple repair, when you\u2019re ready</p><p class="serif">\u201cEarlier I got short with you. I\u2019m sorry. That wasn\u2019t about you. I love you.\u201d</p><p class="small">Repair teaches more than never slipping would.</p></div>' + yours(3, 'Your expectations of yourself');
    var cr = credits(); if (cr.length) o += '<div class="card credit"><p class="eyebrow">Also true</p><p class="serif">' + esc(pick(cr, uid()).t) + '</p></div>';
  } else {
    o += '<h1>Your mind is racing</h1>' + yours(4, 'What it\u2019s usually trying to solve') +
      '<label class="lbl" for="park">Set it down here</label><textarea id="park" rows="3" placeholder="What\u2019s spinning? Write it, then let the page hold it."></textarea><button class="btn small" data-do="park">Set it down</button>' +
      '<div class="card soft"><p><b>Is this mine to solve tonight?</b> If not, it can wait on the page. If yes, what is one small next step?</p></div>' + yours(7, 'What you gave yourself permission to do');
    var pk = entries('parked').slice(0, 3); if (pk.length) o += '<p class="eyebrow">Recently set down</p>' + pk.map(function (p) { return '<p class="small">' + esc(niceDate(p.at)) + ': ' + esc(p.data.text) + '</p>'; }).join('');
  }
  return '<div class="page">' + o + (isShabbat(NOW()) ? '' : '<button class="btn ghost" data-do="ask">Ask Katya about this</button>') + '</div>';
}
function reframe() {
  var r = entries('reframe').filter(function (x) { return String(x.data.text || '').trim(); })[0]; if (r) return r.data.text;
  return 'You care so much that you\u2019re still thinking about it. That\u2019s what a good father does. You can make it right, and one hard moment doesn\u2019t undo all the love you give them.';
}
on('feel', function (f) { ui.limitFeel = f; ui.limitText = ($app.querySelector('#lim') || {}).value || ui.limitText; jset('steady.ui', ui); render(); });
on('buildLimit', function () { ui.limitText = $app.querySelector('#lim').value.trim(); jset('steady.ui', ui); render(); });
on('park', function () { var t = $app.querySelector('#park').value.trim(); if (!t) return; entry('parked', { text: t }); toast('Saved'); render(); });

/* ---------- Small moments ---------- */
var TAGS = ['One-on-one', 'We laughed', 'Opened up', 'Just together', 'Repaired'];
on('kid', function (k) { var t = $app.querySelector('#mtext').value; ui.kid = k; jset('steady.ui', ui); route.preset = Object.assign({}, route.preset, { kid: k }); render(); $app.querySelector('#mtext').value = t; });
on('tag', function (t, b) { var on_ = b.classList.contains('on'); $app.querySelectorAll('.chip.tag').forEach(function (x) { x.classList.remove('on'); }); if (!on_) b.classList.add('on'); route.preset = Object.assign({}, route.preset, { tag: on_ ? '' : t }); });
on('saveMoment', function () { var t = $app.querySelector('#mtext').value.trim(); var tg = $app.querySelector('.chip.tag.on'); if (!t && !tg) { toast('Write a few words or pick a tag'); return; }
  entry('moment', { kid: (route.preset || {}).kid || ui.kid || child(), text: t, tag: tg ? tg.dataset.arg : '' }); route.preset = {}; toast('Saved'); render(); });

/* ---------- Care: self-compassion + self-care ---------- */
on('winx', function () { var v = $app.querySelector('#winx').value.trim(); if (v) { entry('win', { label: v }); toast('Saved'); render(); } });
on('saveRef', function () { var v = $app.querySelector('#ref').value.trim(); if (v) { entry('reframe', { text: v }); toast('Kept'); render(); } });
function setPlan(list) { var p = entries('plan')[0]; entry('plan', { items: list }, p ? p.id : 'plan'); render(); }
on('addPlan', function (s) { var p = entries('plan')[0]; setPlan((p ? p.data.items : []).concat([s])); });
on('planx', function () { var v = $app.querySelector('#planx').value.trim(); if (v) { var p = entries('plan')[0]; setPlan((p ? p.data.items : []).concat([v])); } });
on('rmPlan', function (i) { var p = entries('plan')[0]; var l = p.data.items.slice(); l.splice(+i, 1); setPlan(l); });

/* ---------- Reflect / revisit ---------- */
/* ---------- time + Shabbat ---------- */
function NOW() { var f = LS.getItem('steady.fakeNow'); return f ? new Date(f) : new Date(); }
function sunset(d) {
  var lat = parseFloat(V.config.lat) || 40.7, lon = parseFloat(V.config.lon) || -74.0, R = Math.PI / 180;
  var start = new Date(d.getFullYear(), 0, 0), J = Math.floor((d - start) / 864e5), g = 2 * Math.PI / 365 * (J - 1);
  var eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  var dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  var ha = Math.acos(Math.cos(90.833 * R) / (Math.cos(lat * R) * Math.cos(dec)) - Math.tan(lat * R) * Math.tan(dec)) / R;
  var m = 720 - 4 * (lon - ha) - eq;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + m * 60000);
}
function isShabbat(d) {
  d = d || NOW(); var w = d.getDay();
  if (w === 5) return d >= new Date(sunset(d) - 18 * 60000);
  if (w === 6) return d < new Date(+sunset(d) + 50 * 60000);
  return false;
}

/* ---------- gratitude journal ---------- */
var HARSH = /\b(messed (it )?up|screw(ed)? up|fail(ed|ure|ing)?|bad (father|dad|parent)|terrible|awful|ruin(ed)?|my fault|(did it|failed|lost it|snapped) again|always do this|never get it right|idiot|stupid|useless|should have|shouldn'?t have|not good enough|worst)\b/i;
function jToday(kind) { return entries('journal').filter(function (j) { return j.data.kind === kind && day(j.at) === day(nowStr(NOW())); })[0]; }
var jdraft = {};
on('journal', function (kind) { var ex = jToday(kind); jdraft = ex ? Object.assign({}, ex.data, { eid: ex.id }) : { kind: kind }; open(function () { return vJournal(kind); }); });
function kidChips(field, cur) { return '<div class="chips">' + kids().map(function (k) { return '<button class="chip' + (k === cur ? ' on' : '') + '" data-do="jkid" data-arg="' + field + '|' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>'; }
function jf(id, label, hint, rows) { return '<label class="lbl" for="j_' + id + '">' + label + '</label>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '<textarea id="j_' + id + '" rows="' + (rows || 2) + '">' + esc(jdraft[id] || '') + '</textarea>'; }
function vJournal(kind) {
  var o = back();
  if (kind === 'am') {
    var idea = jdraft.kid ? pick(jdraft.kid === child() ? oneOnOneIdeas() : ['A few minutes of their favorite thing, together', 'Ask about something they care about, then just listen', 'A silly moment at breakfast'], today() + jdraft.kid) : '';
    o += '<p class="eyebrow">Good morning</p><h1>Just a minute</h1>' +
      jf('intention', 'Who do I want to be with the kids today?', 'One word or one line is enough. Calm, present, playful\u2026') +
      '<label class="lbl">One child to give a small moment to <span class="opt">optional</span></label>' + kidChips('kid', jdraft.kid) +
      (idea ? '<p class="hint">Maybe: \u201c' + esc(idea) + '\u201d</p>' : '') +
      jf('grateful', 'One thing I\u2019m grateful for', 'Big or tiny.') + aboutChips();
  } else {
    var gv = items(1), ci = careItems();
    o += '<p class="eyebrow">This evening</p><h1>What went right today</h1><p class="small">Any of these can stay blank.</p>' +
      jf('proud', 'Something I\u2019m proud of as a dad today', '') +
      jf('moment', 'One small moment of connection', 'A look, a joke, a ride. Small counts.') + kidChips('momentKid', jdraft.momentKid) +
      jf('gave', 'Something I gave them that I\u2019d usually overlook', gv.length ? 'Like you wrote: \u201c' + esc(pick(gv, today() + 'g')) + '\u201d' : 'Patience, a hug, being home for dinner\u2026') +
      jf('care', 'Something I did to take care of myself', ci.length ? 'Even a little: \u201c' + esc(pick(ci, today() + 'j')) + '\u201d' : 'Even five minutes counts.') +
      jf('love', 'Something I love or admire about one of them <span class="opt">optional</span>', 'Goes into their letter.') + kidChips('loveKid', jdraft.loveKid || child()) + aboutChips();
  }
  return '<div class="page">' + o + '<button class="btn primary" data-do="saveJournal" data-arg="' + kind + '">Save</button></div>';
}
function readJ(kind) { ['intention', 'grateful', 'proud', 'moment', 'gave', 'care', 'love'].forEach(function (f) { var e = $app.querySelector('#j_' + f); if (e) jdraft[f] = e.value.trim(); }); }
function aboutChips() { var a = jdraft.about || []; return '<label class="lbl">This entry is about <span class="opt">optional \u00b7 shows on their page</span></label><div class="chips">' + kids().concat(['Me']).map(function (k) { return '<button class="chip' + (a.indexOf(k) >= 0 ? ' on' : '') + '" data-do="jabout" data-arg="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>'; }
on('jabout', function (k) { var kind = jdraft.kind; readJ(); var a = (jdraft.about || []).slice(), i = a.indexOf(k); if (i >= 0) a.splice(i, 1); else a.push(k); jdraft.about = a; open(function () { return vJournal(kind); }); });
on('jkid', function (a) { var p = a.split('|'), kind = jdraft.kind; readJ(); jdraft[p[0]] = jdraft[p[0]] === p[1] && p[0] !== 'loveKid' ? '' : p[1]; open(function () { return vJournal(kind); }); });
on('saveJournal', function (kind) {
  readJ(); var all = ['intention', 'grateful', 'proud', 'moment', 'gave', 'care', 'love'].map(function (f) { return jdraft[f] || ''; }).join('\n');
  if (!all.trim()) { toast('Nothing to save yet'); return; }
  var m = all.match(HARSH);
  if (m && !jdraft.kindChecked) { open(function () { return vKinder(m[0], all); }); return; }
  commitJournal();
});
function kinderRewrite() { var r = entries('reframe').filter(function (x) { return String(x.data.text || '').trim(); })[0]; return r ? r.data.text : 'Today had a hard moment, and I care enough to notice it. That\u2019s what a loving father does. I can repair it, and it doesn\u2019t undo the love I give them every day.'; }
function vKinder(word) {
  return '<div class="page"><div class="ptop"><button class="link" data-do="backJ">\u2190 Back to my entry</button></div><p class="eyebrow">A gentle pause</p><h1>You wrote \u201c' + esc(word) + '.\u201d</h1>' +
    '<p>If someone you love said that about themselves, how would you answer them?</p>' +
    '<div class="script"><p class="eyebrow">A kinder way to say it</p><p class="serif">' + esc(kinderRewrite()) + '</p></div>' +
    '<textarea id="kind" rows="4" placeholder="Or write it your way, the way you\u2019d say it to a friend"></textarea>' +
    '<button class="btn primary" data-do="keepKind">Keep the kinder version</button><button class="btn ghost" data-do="skipKind">Save my entry as it is</button></div>';
}
on('backJ', function () { var k = jdraft.kind; open(function () { return vJournal(k); }); });
on('keepKind', function () { var t = $app.querySelector('#kind').value.trim(); jdraft.kinder = t || kinderRewrite(); if (t) entry('reframe', { text: t }); commitJournal(); });
on('skipKind', function () { commitJournal(); });
function commitJournal() {
  var back_ = jdraft.backTo; delete jdraft.backTo;
  var d = Object.assign({}, jdraft), eid = d.eid || uid(); delete d.eid; delete d.kindChecked;
  entry('journal', d, eid);
  if (d.kind === 'pm' && d.moment) { var me = 'jm_' + eid; entry('moment', { kid: d.momentKid || child(), text: d.moment, tag: 'From journal' }, me); }
  if (d.kind === 'pm' && d.love) entry('love', { kid: d.loveKid || child(), text: d.love, src: 'journal' }, 'jl_' + eid);
  toast(d.kind === 'am' ? 'Have a good day.' : 'Saved. Rest well.'); if (back_) { route = { tab: 'person' }; ui.portal = back_; jset('steady.ui', ui); open(function () { return vSec(back_, 'journal'); }); } else go('home');
}
function journalHistory() {
  var js = entries('journal').slice(0, 6);
  var o = '<div class="card"><p class="eyebrow">Gratitude journal</p><div class="row2"><button class="btn small" data-do="journal" data-arg="am">Morning</button><button class="btn small" data-do="journal" data-arg="pm">Evening</button></div>';
  o += js.map(function (j) { var x = j.data; return '<div class="jentry"><p class="small">' + esc(niceDate(j.at)) + ' \u00b7 ' + (x.kind === 'am' ? 'Morning' : 'Evening') + '</p>' +
    [['intention', 'Today I want to be'], ['grateful', 'Grateful for'], ['proud', 'Proud of'], ['moment', 'A moment'], ['gave', 'I gave them'], ['care', 'For myself'], ['kinder', 'Kinder version']].filter(function (f) { return x[f[0]]; }).map(function (f) { return '<p><b>' + f[1] + ':</b> ' + esc(x[f[0]]) + '</p>'; }).join('') + ((x.about || []).length ? '<p class="small">About ' + esc(x.about.join(', ')) + '</p>' : '') + '</div>'; }).join('');
  return o + '</div>';
}

/* ---------- letters ---------- */
var lkid = null;
function loves(k) { return entries('love').filter(function (l) { return l.data.kid === k; }); }
function lettersCard(inPortal) {
  var k = lkid || child(), ls = loves(k), lt = entries('letter').filter(function (l) { return l.data.kid === k; }), q = inPortal && isShabbat(NOW());
  return '<div class="card letter-card">' +
    (inPortal ? '<p class="small">Built from what you notice and the moments you keep. ' + ls.length + ' thing' + (ls.length === 1 ? '' : 's') + ' noted so far.</p>' :
    '<div class="chips">' + kids().map(function (x) { return '<button class="chip' + (x === k ? ' on' : '') + '" data-do="lkid" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
    '<p class="small">Things you love or admire about ' + esc(k) + '. One line at a time, whenever you notice.</p>' +
    '<div class="inline"><input id="lovex" placeholder="I love how\u2026"><button class="btn small" data-do="addLove">Add</button></div>' +
    (ls.length ? '<ul class="wall">' + ls.slice(0, 8).map(function (l) { return '<li><span>' + esc(l.data.text) + '</span><small>' + esc(niceDate(l.at)) + (l.data.src === 'journal' ? ' \u00b7 from your evening journal' : '') + '</small></li>'; }).join('') + '</ul>' + (ls.length > 8 ? '<p class="small">+ ' + (ls.length - 8) + ' more</p>' : '') : '')) +
    (q ? '' : '<button class="btn primary" data-do="compose">Compose letter</button>') +
    (lt.length ? '<p class="small">Saved letters: ' + lt.map(function (l) { return '<a href="#" data-do="openLetter" data-arg="' + l.id + '">' + esc(l.data.occasion || 'Letter') + ' \u00b7 ' + esc(niceDate(l.at)) + '</a>'; }).join(', ') + '</p>' : '') + '</div>';
}
on('lkid', function (k) { lkid = k; render(); });
on('addLove', function () { var v = $app.querySelector('#lovex').value.trim(); if (!v) return; entry('love', { kid: route.tab === 'person' ? portal() : lkid || child(), text: v }); toast('Kept for the letter'); render(); });
var OCC = { 'Birthday': ['Happy birthday. Another year of watching you grow, and I wanted to write down some of what I see.', 'I\u2019m so proud to be your father. I hope this year is full of good things.'],
  'A milestone': ['This is a big day, and before it passes I wanted to tell you some things I don\u2019t always say out loud.', 'Whatever comes next, I\u2019m right behind you.'],
  'A hard week': ['I know this week has been hard. You don\u2019t have to talk about it. I just wanted you to have this.', 'Hard weeks end. What I feel about you doesn\u2019t change. I\u2019m here whenever you want me.'],
  'Just because': ['No reason for this letter except that I love you and wanted you to know it in writing.', 'I\u2019m lucky to be your father.'] };
var letter = null;
on('compose', function () { var k = lkid || child(); letter = { kid: k, occasion: 'Just because' }; letter.text = buildLetter(k, letter.occasion); open(vLetter); });
on('openLetter', function (id) { var l = entries('letter').filter(function (x) { return x.id === id; })[0]; if (!l) return; letter = Object.assign({ eid: l.id }, l.data); open(vLetter); });
function buildLetter(k, occ) {
  var ls = uniqText(loves(k).slice().reverse().map(function (l) { return l.data.text.replace(/\.$/, ''); }));
  var ms = uniqText(entries('moment').filter(function (m) { return m.data.kid === k && m.data.text; }).map(function (m) { return m.data.text.replace(/\.$/, ''); })).slice(0, 4).reverse();
  var o = OCC[occ], t = 'Dear ' + k + ',\n\n' + o[0] + '\n\n';
  if (ls.length) t += 'Some things I love about you:\n' + ls.map(function (x) { return '\u2022 ' + x; }).join('\n') + '\n\n';
  if (ms.length) t += 'Some small moments with you that I keep with me:\n' + ms.map(function (x) { return '\u2022 ' + x; }).join('\n') + '\n\n';
  if (!ls.length && !ms.length) t += '[Write a few things you love about ' + k + ' here]\n\n';
  return t + o[1] + '\n\nI love you always,\nAbba';
}
function vLetter() {
  return '<div class="page"><div class="ptop"><button class="link" data-do="closeO">\u2190 Back</button></div><h1>Letter to ' + esc(letter.kid) + '</h1>' +
    '<p class="small">Built from what you noticed and the moments you kept. Edit anything.</p>' +
    '<div class="chips">' + Object.keys(OCC).map(function (x) { return '<button class="chip' + (x === letter.occasion ? ' on' : '') + '" data-do="occ" data-arg="' + x + '">' + x + '</button>'; }).join('') + '</div>' +
    '<textarea id="ltext" class="letter" rows="18">' + esc(letter.text) + '</textarea>' +
    '<button class="btn primary" data-do="saveLetter">Keep this letter</button><button class="btn ghost" data-do="copyLetter">Copy text</button></div>';
}
on('occ', function (x) { var cur = $app.querySelector('#ltext').value; if (cur === letter.text || confirm('Start over with the ' + x + ' opening? Your edits will be replaced.')) { letter.occasion = x; letter.text = buildLetter(letter.kid, x); open(vLetter); } });
on('saveLetter', function () { var t = $app.querySelector('#ltext').value; letter.text = t; entry('letter', { kid: letter.kid, occasion: letter.occasion, text: t }, letter.eid || (letter.eid = uid())); toast('Letter kept privately'); });
on('copyLetter', function () { var t = $app.querySelector('#ltext').value; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Copied'); }, function () { toast('Select the text and copy it'); }); });

/* ---------- portals: one per child, and one for you ---------- */
function ages() { var m = {}; String(V.config.ages || LS.getItem('steady.ages') || '').split(',').forEach(function (p) { var x = p.split(':'); if (x[1]) m[x[0].trim()] = parseInt(x[1], 10); }); return m; }
function portal() { var p = ui.portal, ks = kids(); return p === 'Me' || ks.indexOf(p) >= 0 ? p : ks.indexOf(child()) >= 0 ? child() : ks[0]; }
var ACC = ['#C2714C', '#5F87A3', '#9C6E9E', '#B4893A', '#5E8C7B'];
function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
function photoOf(k) { var m = memories(k).filter(function (x) { return x.data.thumb; })[0]; return m ? m.data.thumb : ''; }
function stage(a) { return a == null || isNaN(a) ? 'kid' : a < 5 ? 'little' : a < 10 ? 'kid' : 'teen'; }
var NEEDS = { little: ['Floor time, at their level', 'Slow, sing-song transitions', 'Being held when it\u2019s too much', 'Same bedtime words every night', 'Me noticing out loud what they\u2019re doing'],
  kid: ['Undivided attention for ten minutes', 'Me being curious, not correcting', 'Help naming big feelings', 'A predictable rhythm'],
  teen: ['Space without distance', 'Me available, not pushing', 'Being taken seriously', 'Side-by-side time with no agenda', 'Trust, a little more than feels comfortable', 'Repair when I get it wrong'] };
var NOTICE_PH = { little: 'The way they light up when\u2026', kid: 'I notice how\u2026', teen: 'I noticed how\u2026' };
function forKid(type, k) { return entries(type).filter(function (e) { return e.data.kid === k; }); }
function journalFor(k) { return entries('journal').filter(function (j) { var x = j.data; return (x.about || []).indexOf(k) >= 0 || (k !== 'Me' && (x.kid === k || x.momentKid === k || x.loveKid === k)) || (k === 'Me' && x.care); }); }
function jline(j) { var x = j.data, f = [['intention', 'Wanted to be'], ['grateful', 'Grateful for'], ['proud', 'Proud of'], ['moment', 'A moment'], ['gave', 'I gave them'], ['care', 'For myself'], ['love', 'I love'], ['kinder', 'Kinder version']];
  return '<div class="entry"><p class="when">' + esc(niceDate(j.at)) + ' \u00b7 ' + (x.kind === 'am' ? 'Morning' : 'Evening') + '</p>' + f.filter(function (y) { return x[y[0]]; }).map(function (y) { return '<p><b>' + y[1] + '</b> ' + esc(x[y[0]]) + '</p>'; }).join('') + '</div>'; }
function strip(k) { var t = memories(k).filter(function (m) { return m.data.thumb; }).slice(0, 4); return t.length ? '<span class="strip">' + t.map(function (m) { return '<span style="background-image:url(' + esc(m.data.thumb) + ')"></span>'; }).join('') + '</span>' : ''; }
on('sec', function (s) { var k = portal(); open(function () { return vSec(k, s); }); });
function vSec(k, s) {
  var q = isShabbat(NOW()), me = k === 'Me', a = ages()[k], o = '', title = SECS[s][1];
  if (s === 'notice') { var ls = loves(k); title = 'What I notice';
    if (!q) o += '<div class="inline"><input id="lovex" placeholder="' + esc(NOTICE_PH[stage(a)]) + '"><button class="btn small" data-do="addLove">Add</button></div>';
    o += ls.length ? '<ul class="wall">' + ls.map(function (l) { return '<li><span>' + esc(l.data.text) + '</span><small>' + esc(niceDate(l.at)) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">Nothing yet.</p>'; }
  if (s === 'needs') { var nd = forKid('need', k), sd = me ? items(6).concat(items(5)) : NEEDS[stage(a)]; title = me ? 'What I need' : 'What ' + k + ' needs';
    o += nd.length ? '<ul class="plan">' + nd.map(function (n) { return '<li><span>' + esc(n.data.text) + '</span>' + (q ? '' : '<button class="x" data-do="rmNeed" data-arg="' + n.id + '" >Remove</button>') + '</li>'; }).join('') + '</ul>' : '';
    if (!q) o += '<div class="chips">' + sd.filter(function (x) { return !nd.some(function (n) { return n.data.text === x; }); }).slice(0, 5).map(function (x) { return '<button class="chip" data-do="addNeed" data-arg="' + esc(x) + '">+ ' + esc(x) + '</button>'; }).join('') + '</div><div class="inline"><input id="needx" placeholder="In my own words"><button class="btn small" data-do="needx">Add</button></div>'; }
  if (s === 'mem') o += memoriesCard(k, q);
  if (s === 'moments') { var mo = forKid('moment', k), oi = k === child() ? uniqText(items(12).concat(items(11))) : []; title = 'Moments together';
    if (!q && oi.length) o += '<p class="lbl">Your one-on-one ideas</p><div class="chips">' + oi.slice(0, 8).map(function (x) { return '<button class="chip" data-do="useIdea" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>';
    if (!q) o += '<textarea id="mtext" rows="2" placeholder="What happened?"></textarea><div class="chips">' + TAGS.map(function (t) { return '<button class="chip tag" data-do="tag" data-arg="' + t + '">' + t + '</button>'; }).join('') + '</div><button class="btn primary" data-do="saveMomentK">Save moment</button>';
    o += mo.length ? '<div class="list">' + mo.map(function (m) { return '<div class="moment"><p class="when">' + esc(niceDate(m.at)) + (m.data.tag ? ' \u00b7 ' + esc(m.data.tag) : '') + '</p>' + (m.data.text ? '<p>' + nl(m.data.text) + '</p>' : '') + '</div>'; }).join('') + '</div>' : ''; }
  if (s === 'journal') { var js = journalFor(k);
    if (!q) o += '<div class="row2"><button class="btn" data-do="jfor" data-arg="am">Morning journal</button><button class="btn" data-do="jfor" data-arg="pm">Evening journal</button></div>';
    o += js.length ? '<div class="list">' + js.map(jline).join('') + '</div>' : '<p class="empty">Tag an entry with ' + esc(me ? 'Me' : k) + ' and it lands here.</p>'; }
  if (s === 'letter') { lkid = k; title = 'Letter to ' + k; o += lettersCard(true); }
  if (s === 'kind') { var sc = entries('selfcheck'), last = sc[0]; title = 'Kindness';
    o += '<p class="big-quote">' + esc(pick(SELF, today() + 's')) + '</p>';
    if (!q) o += '<p class="q">How am I treating myself today?</p><div class="chips">' + TONES.map(function (t) { return '<button class="chip' + (last && day(last.at) === today() && last.data.tone === t[0] ? ' on' : '') + '" data-do="tone" data-arg="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (last && day(last.at) === today() && last.data.tone === 'hard') o += '<div class="script"><p class="serif">What would you say to a friend who felt this way tonight?</p></div>';
    if (sc.length) o += '<p class="when">Lately: ' + sc.slice(0, 7).map(function (x) { return ({ gentle: 'Gently', okay: 'Getting by', hard: 'Hard on myself' })[x.data.tone]; }).join(', ') + '</p>'; }
  if (s === 'talk') { var harsh = latest(2).trim(), rf = entries('reframe').filter(function (x) { return String(x.data.text || '').trim(); });
    if (harsh) o += '<p class="quote">' + nl(harsh) + '</p>';
    if (!q) o += '<textarea id="talk" rows="3" placeholder="What am I telling myself?"></textarea><button class="btn primary" data-do="checkTalk">Look at it kindly</button>';
    o += '<p class="q">Kinder versions</p>' + (rf.length ? '<ul class="wall">' + rf.slice(0, 8).map(function (r) { return '<li><span>' + esc(r.data.text) + '</span><small>' + esc(niceDate(r.at)) + '</small></li>'; }).join('') + '</ul>' : '<p class="serif">' + esc(reframe()) + '</p>'); }
  if (s === 'wins') { var ws = entries('win'), wk = ws.filter(function (w) { return daysAgo(w.at) < 7; }).length;
    if (!q) o += '<div class="chips">' + WINS.map(function (x) { return '<button class="chip" data-do="win" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div><div class="inline"><input id="winx" placeholder="Something else"><button class="btn small" data-do="winx">Add</button></div>';
    o += ws.length ? '<ul class="wall">' + ws.slice(0, 12).map(function (w) { return '<li><span>' + esc(w.data.label) + '</span><small>' + esc(niceDate(w.at)) + '</small></li>'; }).join('') + '</ul>' : ''; }
  return '<div class="page sec-page" style="--a:' + accent(k) + '"><div class="bar"><button class="link" data-do="closeO">\u2190 ' + esc(me ? 'Me' : k) + '</button></div>' +
    '<header class="shead">' + avatar(k, 'sm') + '<h1>' + esc(title) + '</h1></header>' + (q ? '<p class="quiet">Shabbat \u00b7 just for reading</p>' : '') + o + '</div>';
}
on('addNeed', function (t) { entry('need', { kid: portal(), text: t }); render(); });
on('needx', function () { var v = $app.querySelector('#needx').value.trim(); if (v) { entry('need', { kid: portal(), text: v }); toast('Kept'); render(); } });
on('rmNeed', function (id) { delEntry(id); render(); });
on('useIdea', function (x) { var t = $app.querySelector('#mtext'); if (t) { t.value = x; t.focus(); } $app.querySelectorAll('.chip.tag').forEach(function (c) { c.classList.toggle('on', c.dataset.arg === 'One-on-one'); }); });
on('saveMomentK', function () { var t = $app.querySelector('#mtext').value.trim(), tg = $app.querySelector('.chip.tag.on'); if (!t && !tg) { toast('A few words or a tag'); return; } entry('moment', { kid: portal(), text: t, tag: tg ? tg.dataset.arg : '' }); toast('Saved'); render(); });
on('jfor', function (kind) { var k = portal(), ex = jToday(kind); jdraft = ex ? Object.assign({}, ex.data, { eid: ex.id }) : { kind: kind }; var a = (jdraft.about || []).slice(); if (a.indexOf(k) < 0) a.push(k); jdraft.about = a; jdraft.backTo = k; open(function () { return vJournal(kind); }); });
var SELF = ['You are allowed to be a work in progress and a good father at the same time.', 'Tired is not the same as failing.', 'You would never hold a friend to the standard you hold yourself to.', 'Coming back after a hard moment is the skill. You keep doing it.', 'Rest is not something you have to earn.'];
var TONES = [['gentle', 'Gently'], ['okay', 'Getting by'], ['hard', 'Hard on myself']];
on('tone', function (t) { var l = entries('selfcheck')[0]; entry('selfcheck', { tone: t }, l && day(l.at) === today() ? l.id : uid()); toast(t === 'hard' ? 'Noticed. Go easy tonight.' : 'Noted.'); render(); });
on('checkTalk', function () { var t = $app.querySelector('#talk').value.trim(); if (!t) return; var m = t.match(HARSH);
  if (!m) { entry('reframe', { text: t }); toast('Kept'); render(); return; }
  open(function () { return '<div class="page"><div class="bar"><button class="link" data-do="secBack" data-arg="talk">\u2190 Self-talk</button></div><h1>You wrote \u201c' + esc(m[0]) + '.\u201d</h1><p class="quote">' + nl(t) + '</p><p class="q">Would you say that to someone you love?</p>' +
    '<div class="script"><p class="serif">' + esc(kinderRewrite()) + '</p></div><textarea id="kind" rows="4" placeholder="Or in your own words"></textarea><button class="btn primary" data-do="keepTalk">Keep the kinder version</button></div>'; }); });
on('keepTalk', function () { var t = $app.querySelector('#kind').value.trim(); entry('reframe', { text: t || kinderRewrite() }); toast('Kept'); var k = portal(); open(function () { return vSec(k, 'talk'); }); });
on('secBack', function (s) { var k = portal(); open(function () { return vSec(k, s); }); });

/* ---------- home ---------- */
function vMemories() {
  var f = ui.memf || 'all', ks = kids().concat(['Me']);
  return '<h1>Memories</h1><div class="chips">' + ['all'].concat(ks).map(function (k) { return '<button class="chip' + (k === f ? ' on' : '') + '" data-do="memf" data-arg="' + esc(k) + '">' + (k === 'all' ? 'Everyone' : esc(k)) + '</button>'; }).join('') + '</div>' +
    (f === 'all' ? memoriesCard(null, isShabbat(NOW())) : memoriesCard(f, isShabbat(NOW())));
}
on('memf', function (k) { ui.memf = k; jset('steady.ui', ui); render(); });

/* ---------- archive: every entry, one shape ---------- */
function af() { var f = ui.af || {}; return { who: f.who || [], types: f.types || [], q: f.q || '' }; }
function filtered(f) { f = f || af(); var q = f.q.toLowerCase().trim();
  return allItems().filter(function (it) { return (!f.who.length || it.who.some(function (w) { return f.who.indexOf(w) >= 0; })) && (!f.types.length || f.types.indexOf(it.type) >= 0) && (!q || (it.title + ' ' + it.text + ' ' + it.who.join(' ')).toLowerCase().indexOf(q) >= 0); }); }
function dots(who) { return '<span class="pdots">' + who.map(function (w) { return '<i style="background:' + accent(w) + '"></i>'; }).join('') + '</span>'; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function uniqWho(its) { var s = []; its.forEach(function (i) { i.who.forEach(function (w) { if (s.indexOf(w) < 0) s.push(w); }); }); var order = kids().concat(['Me']); return s.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); }); }
function onThisDay() {
  var its = allItems(), t = today(), wk = new Date(t + 'T12:00:00'); wk.setDate(wk.getDate() - 7); var w = ymd(wk);
  var past = its.filter(function (i) { return i.day !== t && i.day.slice(5) === t.slice(5); });
  if (past.length) return { label: 'On this day', it: pick(past, t + 'o') };
  var lw = its.filter(function (i) { return i.day === w && (i.type === 'memory' || i.type === 'moment' || i.type === 'notice'); });
  if (lw.length) return { label: 'A week ago', it: pick(lw, t + 'w') };
  return null;
}
/* search box updates results without stealing focus */
/* ---------- clean versions of the older screens ---------- */
on('care', function (s) { open(function () { return vCareSec(s); }); });

/* ---------- memories: photos + videos, private Drive via the backend ---------- */
var PROUD = [['of', 'Proud of them'], ['from', 'Proud from them'], ['me', 'Proud of myself']];
var idb = null;
function db() { if (idb) return idb; idb = new Promise(function (res, rej) { var r = indexedDB.open('steady-media', 1); r.onupgradeneeded = function () { r.result.createObjectStore('m', { keyPath: 'id' }); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return idb; }
function idbDo(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('m', mode), s = t.objectStore('m'), r = fn(s); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }); }
var pendingN = 0, localURL = {};
function memories(k) { return entries('memory').filter(function (m) { return k == null || m.data.kid === k; }).sort(function (a, b) { var x = (a.data.date || day(a.at)) + a.at, y = (b.data.date || day(b.at)) + b.at; return x < y ? 1 : -1; }); }
function memoriesCard(k, q) {
  var ms = memories(k), o = '<div class="mem-card">';
  if (!q) o += '<button class="btn primary" data-do="addMem">+ Add a photo or video</button>';
  var waiting = ms.filter(function (m) { return m.data.mime && !m.data.fileId; }).length;
  if (waiting) o += '<p class="quiet">' + waiting + ' safe on this phone \u00b7 ' + (sync.state === 'ok' ? 'uploading\u2026' : 'will move to your private Drive once setup is done') + '</p>';
  if (!ms.length) return o + '<p class="empty">No memories yet.</p></div>';
  var cur = '';
  ms.slice(0, 60).forEach(function (m) { var d = m.data, dd = d.date || day(m.at);
    if (dd !== cur) { o += (cur ? '</div>' : '') + '<p class="tday">' + esc(new Date(dd + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) + '</p><div class="tl">'; cur = dd; }
    o += '<button class="mem" data-do="openMem" data-arg="' + m.id + '">' + (d.thumb ? '<span class="th" style="background-image:url(' + esc(d.thumb) + ')">' + (/^video/.test(d.mime) ? '<b>Video</b>' : '') + '</span>' : '') +
      '<span class="mtx"><small>' + (k == null ? esc(d.kid) + ' \u00b7 ' : '') + esc((PROUD.filter(function (p) { return p[0] === d.proud; })[0] || ['', ''])[1]) + '</small>' + esc(d.note || '') + '</span></button>'; });
  return o + '</div></div>';
}
var mem = null;
on('addMem', function () { var pk = route.tab === 'memories' ? (ui.memf && ui.memf !== 'all' ? ui.memf : child()) : portal(); mem = { from: overlay, kid: pk, date: today(), proud: pk === 'Me' ? 'me' : 'of', files: [] }; open(vMem); });
function vMem() {
  var who = kids().concat(['Me']);
  return '<div class="page"><div class="bar"><button class="link" data-do="memBack">\u2190 Back</button></div><h1>A memory</h1>' +
    '<label class="lbl">Who</label><div class="chips">' + who.map(function (k) { return '<button class="chip' + (k === mem.kid ? ' on' : '') + '" data-do="memWho" data-arg="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' +
    '<label class="lbl" for="mdate">Day</label><input id="mdate" type="date" value="' + esc(mem.date) + '" max="' + today() + '">' +
    '<label class="lbl">Photos or videos</label><label class="btn" for="mfile">' + (mem.files.length ? 'Add more' : 'Choose photos or videos') + '</label><input id="mfile" type="file" accept="image/*,video/*" multiple hidden>' +
    '<div class="tl">' + mem.files.map(function (f) { return '<span class="th sm" style="background-image:url(' + f.thumb + ')">' + (/^video/.test(f.mime) ? '<b>Video</b>' : '') + '</span>'; }).join('') + '</div>' +
    '<label class="lbl">Proud\u2026</label><div class="chips">' + PROUD.map(function (p) { return '<button class="chip' + (p[0] === mem.proud ? ' on' : '') + '" data-do="memProud" data-arg="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
    '<textarea id="mnote" rows="3" placeholder="' + (mem.proud === 'me' ? 'What I\u2019m proud of in myself here\u2026' : mem.proud === 'from' ? 'What they did that made me proud\u2026' : 'What I\u2019m proud of in them\u2026') + '">' + esc(mem.note || '') + '</textarea>' +
    '<button class="btn primary" data-do="saveMem">Keep this memory</button><p class="quiet center">' + (sync.state === 'ok' ? 'Private \u00b7 your Google Drive only' : 'Kept on this phone for now') + '</p></div>';
}
function keepMemForm() { var n = $app.querySelector('#mnote'), d = $app.querySelector('#mdate'); if (n) mem.note = n.value; if (d && d.value) mem.date = d.value; }
on('memBack', function () { var f = mem && mem.from; mem = null; overlay = f; render(); });
on('memWho', function (k) { keepMemForm(); mem.kid = k; if (k === 'Me') mem.proud = 'me'; else if (mem.proud === 'me') mem.proud = 'of'; open(vMem); });
on('memProud', function (p) { keepMemForm(); mem.proud = p; open(vMem); });
function thumbOf(file) {
  return new Promise(function (res) {
    var url = URL.createObjectURL(file), v = /^video/.test(file.type), el = document.createElement(v ? 'video' : 'img');
    function draw() { var w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight, s = 220 / Math.max(w, h, 1), c = document.createElement('canvas'); c.width = Math.round(w * s) || 220; c.height = Math.round(h * s) || 220;
      try { c.getContext('2d').drawImage(el, 0, 0, c.width, c.height); var qq = .7, out = c.toDataURL('image/jpeg', qq); while (out.length > 11000 && qq > .2) { qq -= .1; out = c.toDataURL('image/jpeg', qq); } res(out); } catch (e) { res(''); } URL.revokeObjectURL(url); }
    el.onerror = function () { res(''); };
    if (v) { el.muted = true; el.playsInline = true; el.preload = 'auto'; el.onloadeddata = function () { el.currentTime = Math.min(.5, (el.duration || 1) / 2); }; el.onseeked = draw; } else el.onload = draw;
    el.src = url; setTimeout(function () { res(''); }, 8000);
  });
}
function shrink(file) { /* photos: keep up to 2000px, enough for keeping; videos stay as they are */
  if (!/^image\/(jpeg|png|webp)/.test(file.type)) return Promise.resolve(file);
  return createImageBitmap(file).then(function (b) { var s = Math.min(1, 2000 / Math.max(b.width, b.height)); if (s === 1 && file.size < 3e6) return file; var c = document.createElement('canvas'); c.width = Math.round(b.width * s); c.height = Math.round(b.height * s); c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
    return new Promise(function (r) { c.toBlob(function (x) { r(x || file); }, 'image/jpeg', .86); }); }).catch(function () { return file; });
}
$app.addEventListener('change', function (ev) {
  if (ev.target.id !== 'mfile') return; keepMemForm(); var fs = [].slice.call(ev.target.files || []);
  Promise.all(fs.map(function (f) { if (f.size > 30e6) { toast('That video is a bit long for here. A shorter clip will fit.'); return null; } return Promise.all([shrink(f), thumbOf(f)]).then(function (r) { return { blob: r[0], thumb: r[1], mime: r[0].type || f.type, name: f.name }; }); }))
    .then(function (r) { mem.files = mem.files.concat(r.filter(Boolean)); open(vMem); });
});
on('saveMem', function () {
  keepMemForm(); if (!mem.files.length && !(mem.note || '').trim()) { toast('Add a photo, a video, or a few words'); return; }
  var list = mem.files.length ? mem.files : [null];
  Promise.all(list.map(function (f, i) { var eid = uid(), d = { kid: mem.kid, date: mem.date, proud: mem.proud, note: (mem.note || '').trim() };
    if (f) { d.thumb = f.thumb; d.mime = f.mime; d.local = true; }
    entry('memory', d, eid);
    return f ? idbDo('readwrite', function (s) { return s.put({ id: uid(), eid: eid, blob: f.blob, mime: f.mime, name: f.name, who: mem.kid, date: mem.date }); }) : null; }))
    .then(function () { toast('Kept'); var f = mem.from; mem = null; overlay = f; render(); window.scrollTo(0, 0); mediaFlush(); })
    .catch(function () { toast('Couldn\u2019t keep the file on this phone. The note is saved.'); close(); });
});
function b64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
function post(body) { return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store', body: JSON.stringify(Object.assign({ k: K }, body)) }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || 'error'); return j; }); }
var mflushing = false;
function mediaFlush() {
  if (!API || !K || mflushing || sync.state !== 'ok' || !window.indexedDB) return;
  mflushing = true; var sent = 0;
  idbDo('readonly', function (s) { return s.getAll(); }).then(function (all) {
    pendingN = (all || []).length;
    return (all || []).reduce(function (p, it) { return p.then(function () {
      if (queue.some(function (o) { return o.eid === it.eid; })) return; /* entry first, then its file */
      return b64(it.blob).then(function (data) { return post({ media: { id: it.id, eid: it.eid, mime: it.mime, name: it.name, who: it.who, date: it.date, b64: data } }); })
        .then(function () { sent++; return idbDo('readwrite', function (s) { return s.delete(it.id); }); });
    }); }, Promise.resolve());
  }).then(function () { if (sent) flush(true); }, function () {}).then(function () { mflushing = false; });
}
on('openMem', function (id) { var m = entries('memory').filter(function (x) { return x.id === id; })[0]; if (!m) return; open(function () { return vMemView(m); }); loadMedia(m); });
function vMemView(m) {
  var d = m.data, src = localURL[m.id], v = /^video/.test(d.mime || '');
  return '<div class="page">' + back() + '<p class="eyebrow">' + esc(d.kid) + ' \u00b7 ' + esc(niceDate(d.date || m.at)) + '</p>' +
    (d.mime ? '<div class="viewer">' + (src ? (v ? '<video src="' + src + '" controls playsinline></video>' : '<img src="' + src + '" alt="">') : '<span class="th big" style="background-image:url(' + esc(d.thumb || '') + ')"></span><p class="small center">' + (src === false ? (d.fileId ? 'This one is in your private Drive. <a href="https://drive.google.com/file/d/' + esc(d.fileId) + '/view" target="_blank" rel="noopener noreferrer">Open it there</a>' : 'Waiting on the phone it was added from.') : 'Opening privately\u2026') + '</p>') + '</div>' : '') +
    '<div class="script"><p class="eyebrow">' + esc((PROUD.filter(function (p) { return p[0] === d.proud; })[0] || ['', 'Memory'])[1]) + '</p><p class="serif">' + nl(d.note || '') + '</p></div>' +
    (isShabbat(NOW()) ? '' : '<button class="btn ghost" data-do="rmMem" data-arg="' + m.id + '">Remove from the timeline</button>') + '</div>';
}
function loadMedia(m) {
  if (localURL[m.id] || !m.data.mime) return;
  function done(u) { localURL[m.id] = u; if (overlay) { var s = window.scrollY; render(); window.scrollTo(0, s); } }
  idbDo('readonly', function (s) { return s.getAll(); }).then(function (all) { var it = (all || []).filter(function (x) { return x.eid === m.id; })[0];
    if (it) return done(URL.createObjectURL(it.blob));
    if (!m.data.fileId || !API) return done(false);
    return post({ get: m.data.fileId }).then(function (j) { if (!j.file.b64) return done(false); var bin = atob(j.file.b64), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); done(URL.createObjectURL(new Blob([u8], { type: j.file.mime }))); });
  }).catch(function () { done(false); });
}
on('rmMem', function (id) { var m = entries('memory').filter(function (x) { return x.id === id; })[0], up = m && m.data.fileId;
  if (!confirm(up ? 'Remove this memory? The file in your private Drive folder stays.' : 'Remove this memory? Its photo or video on this phone is removed too. Copies you already saved keep it.')) return;
  delEntry(id); mediaAll().then(function (all) { all.filter(function (x) { return x.eid === id; }).forEach(function (x) { idbDo('readwrite', function (s) { return s.delete(x.id); }); }); }); close(); });

/* ---------- Ask Katya ---------- */
on('ask', function () { open(vAsk); });
function vAsk() {
  var ks = V.katya.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return '<div class="page">' + back() + '<h1>Ask Katya</h1><p>Write what happened or what worries you. Katya writes back here.</p>' + (sync.state === 'ok' ? '' : '<p class="quiet">Not connected yet. What you write stays on this phone until it is.</p>') +
    '<textarea id="askt" rows="6" placeholder="Tonight she shut her door after dinner and I wasn\u2019t sure whether to knock\u2026"></textarea><button class="btn primary" data-do="sendAsk">Send to Katya</button>' +
    ks.map(function (k) { return '<div class="thread"><p class="small">' + esc(niceDate(k.at)) + '</p><p class="me">' + nl(k.text) + '</p>' + (k.reply ? '<p class="kat"><b>Katya</b><br>' + nl(k.reply) + '</p>' : '<p class="small">' + (k.status === 'waiting to send' ? 'Saved on this phone. Not sent yet.' : 'Sent. Katya will reply here.') + '</p>') + '</div>'; }).join('') + '</div>';
}
on('sendAsk', function () { var t = $app.querySelector('#askt').value.trim(); if (!t) return; push({ t: 'ask', text: t }); toast(sync.state === 'ok' ? 'Sending to Katya' : 'Saved. Not sent yet.'); render(); });

var deferred = null;
function standalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone; }
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; if (!overlay) render(); });
on('install', function () { if (deferred) { deferred.prompt(); deferred = null; } });
on('noInstall', function () { ui.noInstall = true; jset('steady.ui', ui); render(); });

/* ---------- Save a copy / restore: a file on this phone, never sent anywhere ---------- */
var COPY_KEYS = ['steady.q', 'steady.snap', 'steady.drafts', 'steady.c', 'steady.kids', 'steady.ages', 'steady.spouse'];
var copyMsg = '';
function mediaAll() { return window.indexedDB ? idbDo('readonly', function (s) { return s.getAll(); }).then(function (a) { return a || []; }, function () { return []; }) : Promise.resolve([]); }
function vData() {
  var n = allItems().length, ph = entries('memory').filter(function (m) { return m.data.mime; }).length, last = ui.lastCopy;
  return '<div class="page">' + back() + '<h1>Your data</h1>' +
    '<p>' + esc(syncLine().replace(/\.$/, '')) + '. ' + plural(n, 'entry', 'entries') + ', ' + plural(ph, 'photo or video', 'photos and videos') + '.</p>' +
    '<p class="small">' + (last ? 'Last copy saved ' + esc(niceDate(last)) + '.' : 'No copy saved yet.') + '</p>' +
    '<button class="btn primary" data-do="saveCopy">Save a copy</button>' +
    '<p class="small">One file in your Downloads, with your words and photos. It is not locked, so keep it somewhere private. Nothing is sent anywhere.</p>' +
    '<label class="btn" for="copyfile">Restore from a copy</label><input id="copyfile" type="file" accept=".json,application/json" hidden>' +
    '<p class="small">Adds what is in the file. Nothing on this phone is deleted.</p>' +
    (copyMsg ? '<p class="quiet">' + esc(copyMsg) + '</p>' : '') + '</div>';
}
on('data', function () { copyMsg = ''; open(vData); });
on('saveCopy', function (_, btn) {
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  var data = {}; COPY_KEYS.forEach(function (k) { var v = LS.getItem(k); if (v != null) data[k] = v; });
  mediaAll().then(function (all) {
    return Promise.all(all.map(function (m) { return b64(m.blob).then(function (x) { return { id: m.id, eid: m.eid, mime: m.mime, name: m.name, who: m.who, date: m.date, b64: x }; }, function () { return null; }); }));
  }).then(function (media) {
    media = media.filter(Boolean);
    var head = JSON.stringify({ format: 'steady-copy', version: 1, savedAt: nowStr(), data: data }).slice(0, -1), parts = [head, ',"media":['];
    media.forEach(function (m, i) { parts.push((i ? ',' : '') + JSON.stringify(m)); });
    parts.push(']}');
    var blob = new Blob(parts, { type: 'application/json' }), a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = 'steady-copy-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
    ui.lastCopy = nowStr(); jset('steady.ui', ui);
    copyMsg = 'Saved steady-copy-' + today() + '.json (' + (blob.size > 1e6 ? (blob.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1e3)) + ' KB') + ', ' + plural(media.length, 'photo or video', 'photos and videos') + ').';
    open(vData);
  }).catch(function () { copyMsg = 'Could not save the copy. Nothing changed.'; open(vData); });
});
function mergeById(a, b, key) { var seen = {}, out = (a || []).slice(); out.forEach(function (x) { seen[x[key]] = 1; }); (b || []).forEach(function (x) { if (x && x[key] != null && !seen[x[key]]) { seen[x[key]] = 1; out.push(x); } }); return out; }
$app.addEventListener('change', function (ev) {
  if (ev.target.id !== 'copyfile' || !ev.target.files || !ev.target.files[0]) return;
  var f = ev.target.files[0];
  f.text().then(function (t) {
    var c = JSON.parse(t); if (!c || c.format !== 'steady-copy' || !c.data) throw new Error('not a copy');
    var d = c.data, inQ = JSON.parse(d['steady.q'] || '[]'), inS = JSON.parse(d['steady.snap'] || '{}'), inD = JSON.parse(d['steady.drafts'] || '{}');
    if (!Array.isArray(inQ)) throw new Error('bad');
    var media = (c.media || []).filter(function (m) { return m && m.id && m.b64 && /^(image|video)\//.test(m.mime || ''); });
    var newOps = inQ.filter(function (o) { return o && o.id && !queue.some(function (x) { return x.id === o.id; }); }).length;
    if (!confirm('Restore from the copy saved ' + niceDate(c.savedAt) + '? It adds ' + plural(newOps, 'item') + ' and ' + plural(media.length, 'photo or video', 'photos and videos') + '. Nothing here is deleted.')) return 'cancel';
    var mq = mergeById(queue, inQ, 'id').map(function (o, i) { return { o: o, i: i }; });
    mq.sort(function (x, y) { var a = String(x.o.at || ''), b = String(y.o.at || ''); return a < b ? -1 : a > b ? 1 : x.i - y.i; });
    var ns = { config: Object.assign({}, inS.config || {}, snap.config || {}), answers: mergeById(snap.answers, inS.answers, 'id'), entries: mergeById(snap.entries, inS.entries, 'id'), katya: mergeById(snap.katya, inS.katya, 'id') };
    var nd = Object.assign({}, inD, drafts);
    if (!jset('steady.q', mq.map(function (x) { return x.o; })) || !jset('steady.snap', ns) || !jset('steady.drafts', nd)) throw new Error('full');
    queue = mq.map(function (x) { return x.o; }); snap = ns; drafts = nd;
    ['steady.c', 'steady.kids', 'steady.ages', 'steady.spouse'].forEach(function (k) { if (d[k] && !LS.getItem(k)) LS.setItem(k, d[k]); });
    return mediaAll().then(function (have) {
      var ids = {}; have.forEach(function (m) { ids[m.id] = 1; });
      return media.filter(function (m) { return !ids[m.id]; }).reduce(function (p, m) { return p.then(function () {
        var bin = atob(m.b64), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return idbDo('readwrite', function (s) { return s.put({ id: m.id, eid: m.eid, blob: new Blob([u8], { type: m.mime }), mime: m.mime, name: m.name, who: m.who, date: m.date }); });
      }); }, Promise.resolve());
    }).then(function () { return 'ok'; });
  }).then(function (r) {
    if (r === 'cancel') return;
    V = view(); copyMsg = 'Restored. Everything from the copy is here.'; open(vData); flush();
  }).catch(function (e) { copyMsg = String(e && e.message) === 'full' ? 'Phone storage is full. The restore did not finish. Nothing was deleted.' : 'That file is not a Steady copy. Nothing changed.'; open(vData); });
});

/* ================= v6: organized by date ================= */
function topBar() {
  if (route.tab === 'home') return '<div class="bar brand"><span class="mark" aria-hidden="true"></span><span>Steady</span></div>';
  return '<div class="bar"><button class="link back" data-tab="home">\u2190 Home</button></div>';
}
function render() {
  V = view();
  if (!K) { $app.innerHTML = '<div class="locked"><span class="mark big" aria-hidden="true"></span><h1>Steady</h1><p>This is a private app. Open it from your personal link.</p></div>'; return; }
  var bare = overlay === vWelcome || overlay === vAllDone;
  if (overlay) { $app.innerHTML = '<div class="shell' + (bare ? ' bare' : '') + '">' + overlay() + '</div>'; bindAll(); return; }
  var body = ({ home: vHome, moment: vMoment, care: vCare, reflect: vReflect, person: vPortal, memories: vMemories, archive: vArchive })[route.tab] || vHome; body = body();
  $app.innerHTML = '<main class="page shell">' + topBar() + '<div class="fade">' + body + '</div>' + (route.tab === 'home' ? '<button class="sync link" data-do="data">' + esc(syncLine()) + ' \u00b7 Save a copy</button>' : '<p class="sync">' + esc(syncLine()) + '</p>') + '</main>';
  bindAll();
}
function back() { return '<div class="bar"><button class="link back" data-do="closeO">\u2190 Back</button></div>'; }

/* neutral identity: names in words, no colour coding */
var PCOL = ['#C9774F', '#4F7A9A', '#94689B', '#B08A3E', '#4E8C86'];
function accent(k) { if (k === 'Me') return '#6F8A78'; var i = kids().indexOf(k); return i < 0 ? 'var(--soft)' : PCOL[i % PCOL.length]; }
function avatar(k, cls) { var ph = photoOf(k); return '<span class="av ' + (cls || '') + '" style="--pc:' + accent(k) + (ph ? ';background-image:url(' + esc(ph) + ')' : '') + '" aria-hidden="true">' + (ph ? '' : esc(k === 'Me' ? 'Me' : k.charAt(0))) + '</span>'; }
function bubbles(cur) { return '<div class="seg wide" role="tablist" aria-label="Person">' + kids().concat(['Me']).map(function (k) { return '<button class="' + (k === cur ? 'on' : '') + '" data-do="portal" data-arg="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>'; }
on('portal', function (k) { ui.portal = k; jset('steady.ui', ui); route = { tab: 'person' }; overlay = null; render(); window.scrollTo(0, 0); });
function whoText(who) { return who.join(', '); }
function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }

/* every dated thing, one shape */
var TYPES = [['journal', 'Journal'], ['moment', 'Moments'], ['memory', 'Memories'], ['notice', 'Noticed'], ['win', 'Wins'], ['reflect', 'Reflections'], ['care', 'Care notes'], ['letter', 'Letters']];
var TSING = { journal: 'Journal', moment: 'Moment', memory: 'Memory', notice: 'Noticed', win: 'Win', reflect: 'Reflection', care: 'Care note', letter: 'Letter' };
function allItems() {
  var out = [], ks = kids();
  function add(e, type, who, title, text, extra) { who = (who || []).filter(function (w) { return w === 'Me' || ks.indexOf(w) >= 0; }); if (!who.length) who = ['Me'];
    out.push(Object.assign({ id: e.id, at: e.at, day: (e.data && e.data.date || day(e.at)).slice(0, 10), type: type, who: who, title: title, text: String(text || '') }, extra || {})); }
  V.entries.forEach(function (e) { var d = e.data || {};
    if (e.type === 'journal') { var w = (d.about || []).slice(); [d.kid, d.momentKid, d.loveKid].forEach(function (k) { if (k && w.indexOf(k) < 0) w.push(k); }); if (d.care && w.indexOf('Me') < 0) w.push('Me');
      var f = [['intention', 'Wanted to be'], ['grateful', 'Grateful for'], ['proud', 'Proud of'], ['moment', 'A moment'], ['gave', 'I gave them'], ['care', 'For myself'], ['love', 'I love'], ['kinder', 'Kinder version']].filter(function (y) { return d[y[0]]; });
      add(e, 'journal', w, d.kind === 'am' ? 'Morning journal' : 'Evening journal', f.map(function (y) { return y[1] + ': ' + d[y[0]]; }).join('\n'), { fields: f.map(function (y) { return [y[1], d[y[0]]]; }) }); }
    else if (e.type === 'moment' && !/^jm_/.test(e.id)) add(e, 'moment', [d.kid], d.tag || 'Moment', d.text);
    else if (e.type === 'love' && !/^jl_/.test(e.id)) add(e, 'notice', [d.kid], 'Noticed', d.text);
    else if (e.type === 'win') add(e, 'win', ['Me'], 'Did well', d.label);
    else if (e.type === 'reframe') add(e, 'care', ['Me'], 'Kinder version', d.text);
    else if (e.type === 'parked') add(e, 'care', ['Me'], 'Set down', d.text);
    else if (e.type === 'selfcheck') add(e, 'care', ['Me'], 'How I treated myself', ({ gentle: 'Gently', okay: 'Getting by', hard: 'Hard on myself' })[d.tone] || '');
    else if (e.type === 'memory') add(e, 'memory', [d.kid], (PROUD.filter(function (p) { return p[0] === d.proud; })[0] || ['', 'Memory'])[1], d.note, { thumb: d.thumb, video: /^video/.test(d.mime || '') });
    else if (e.type === 'letter') add(e, 'letter', [d.kid], 'Letter' + (d.occasion ? ' \u00b7 ' + d.occasion : ''), d.text);
  });
  V.answers.forEach(function (a) { var p = P[a.q]; if (!p || !String(a.text || '').trim()) return;
    out.push({ id: a.id, at: a.at, day: day(a.at), type: 'reflect', who: p.s === 'child' && ks.indexOf(child()) >= 0 ? [child()] : ['Me'], title: 'Reflection ' + (a.q + 1), text: String(a.text), q: a.q, fields: [[fill(p.t), a.text]] }); });
  return out.sort(function (a, b) { var x = a.day + a.at, y = b.day + b.at; return x < y ? 1 : -1; });
}
function hasFilter(f) { f = f || af(); return !!(f.q || f.who.length || f.types.length); }
function card(it, showDate) {
  var long = it.text.length > 110 || (it.fields && (it.fields.length > 1 || it.type === 'reflect'));
  var meta = esc(TSING[it.type] || '') + ' \u00b7 ' + esc(whoText(it.who)) + ' \u00b7 ' + (showDate ? esc(niceDate(it.day)) : esc(String(it.at).slice(11, 16)));
  var head = '<span class="cb"><span class="cm">' + meta + '</span><b class="ct">' + esc(it.title) + '</b>' +
    (it.text ? '<span class="cx">' + esc(cut(it.text.replace(/\n+/g, ' \u00b7 '), 110)) + '</span>' : '') + '</span>' +
    (it.thumb ? '<span class="th sm" style="background-image:url(' + esc(it.thumb) + ')">' + (it.video ? '<b>Video</b>' : '') + '</span>' : '');
  if (it.type === 'memory') return '<button class="ent" data-do="openMem" data-arg="' + it.id + '">' + head + '<span class="go">Open</span></button>';
  if (!long) return '<div class="ent">' + head + '</div>';
  return '<details class="ent"><summary>' + head + '<span class="go">More</span></summary><div class="full">' + (it.fields ? it.fields.map(function (f) { return '<p><b>' + esc(f[0]) + '</b>' + nl(f[1]) + '</p>'; }).join('') : '<p>' + nl(it.text) + '</p>') + '</div></details>';
}
function filterBar() { var f = af();
  return '<div class="filters"><label class="lbl" for="asearch">Search</label><input id="asearch" type="search" placeholder="Words, names, anything" value="' + esc(f.q) + '">' +
    '<p class="lbl">Person</p><div class="chips scroll">' + ['all'].concat(kids(), ['Me']).map(function (k) { var on_ = k === 'all' ? !f.who.length : f.who.indexOf(k) >= 0; return '<button class="chip' + (on_ ? ' on' : '') + '" aria-pressed="' + on_ + '" data-do="afWho" data-arg="' + esc(k) + '">' + (k === 'all' ? 'Everyone' : esc(k)) + '</button>'; }).join('') + '</div>' +
    '<p class="lbl">Kind</p><div class="chips scroll">' + [['all', 'Everything']].concat(TYPES).map(function (t) { var on_ = t[0] === 'all' ? !f.types.length : f.types.indexOf(t[0]) >= 0; return '<button class="chip' + (on_ ? ' on' : '') + '" aria-pressed="' + on_ + '" data-do="afType" data-arg="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    (hasFilter(f) ? '<button class="link clear" data-do="afClear">Clear filters</button>' : '') + '</div>';
}
function toggleIn(key, v) { var f = af(), a = f[key].slice(), i = a.indexOf(v); if (v === 'all') a = []; else if (i >= 0) a.splice(i, 1); else a.push(v); f[key] = a; ui.af = f; jset('steady.ui', ui); render(); }
on('afWho', function (k) { toggleIn('who', k); });
on('afType', function (t) { toggleIn('types', t); });
on('afClear', function () { ui.af = { who: [], types: [], q: '' }; jset('steady.ui', ui); render(); });
on('aview', function (v) { ui.aview = v; jset('steady.ui', ui); render(); });

/* date buckets: Today, Yesterday, This week, then month by month */
function bucket(d) { var t = today(), n = daysAgo(d); if (d === t) return ['today', 'Today'];
  if (n === 1) return ['yday', 'Yesterday'];
  if (n > 1 && n < 7) return ['week', 'Earlier this week'];
  return ['m' + d.slice(0, 7), new Date(d.slice(0, 7) + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })]; }
function longDay(s) { return new Date(s + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
function dayHead(s, n) { return '<button class="dayh" data-do="openDay" data-arg="' + s + '"><b>' + esc(longDay(s)) + '</b><span>' + plural(n, 'entry', 'entries') + ' \u00b7 Open day \u203A</span></button>'; }
function grouped(its, limit, daysOnly) {
  var o = '', bk = '', dy = '';
  its.slice(0, limit || 500).forEach(function (it) { var b = bucket(it.day);
    if (daysOnly) { if (it.day !== dy) { dy = it.day; o += dayHead(dy, its.filter(function (x) { return x.day === dy; }).length).replace(longDay(dy), (daysAgo(dy) === 1 ? 'Yesterday, ' : '') + longDay(dy)); } o += card(it); return; }
    if (b[0] !== bk) { if (bk) o += '</section>'; bk = b[0]; dy = ''; var n = its.filter(function (x) { return bucket(x.day)[0] === b[0]; }).length;
      o += '<section class="bucket" id="b-' + b[0] + '"><h2 class="bh"><span>' + esc(b[1]) + '</span><em>' + plural(n, 'entry', 'entries') + '</em></h2>'; }
    if (it.day !== dy) { dy = it.day; if (b[0] !== 'today' && b[0] !== 'yday') o += dayHead(dy, its.filter(function (x) { return x.day === dy; }).length); }
    o += card(it);
  });
  return o + (bk ? '</section>' : '');
}
function feed(its) {
  if (!its.length) return '<p class="empty">' + (hasFilter() ? 'Nothing matches these filters.' : 'Nothing written yet. Your first entry will appear here, under Today.') + '</p>';
  var months = [], seen = {}; its.forEach(function (i) { var b = bucket(i.day); if (!seen[b[0]]) { seen[b[0]] = 1; months.push(b); } });
  return '<div class="jumps"><p class="lbl">Go to</p><div class="chips scroll">' + months.map(function (b) { return '<button class="chip" data-do="jumpTo" data-arg="' + b[0] + '">' + esc(b[1]) + '</button>'; }).join('') + '</div></div>' +
    '<p class="count">' + plural(its.length, 'entry', 'entries') + (hasFilter() ? ' match' : '') + '</p>' + grouped(its);
}
on('jumpTo', function (b) { var el = document.getElementById('b-' + b); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); });
function vArchive() {
  var v = ui.aview || 'feed', its = filtered(), f = af();
  var o = '<header class="ph"><h1>Timeline</h1></header>';
  o += '<div class="seg" role="tablist"><button class="' + (v === 'feed' ? 'on' : '') + '" data-do="aview" data-arg="feed">List by date</button><button class="' + (v === 'cal' ? 'on' : '') + '" data-do="aview" data-arg="cal">Calendar</button></div>';
  o += '<div class="jumpd"><label class="lbl" for="ajump">Jump to a date</label><div class="inline"><input id="ajump" type="date" max="' + today() + '" value="' + esc(ui.ajump || '') + '"><button class="btn small" data-do="jumpDate">Open day</button></div></div>';
  o += '<details class="fwrap"' + (hasFilter(f) || ui.fopen ? ' open' : '') + '><summary>Filter and search' + (hasFilter(f) ? '<em>On</em>' : '') + '</summary>' + filterBar() + '</details>';
  o += '<div id="ares">' + (v === 'cal' ? calendar(its) : feed(its)) + '</div>';
  return o;
}
on('jumpDate', function () { var d = ($app.querySelector('#ajump') || {}).value; if (!d) { toast('Pick a date first'); return; } ui.ajump = d; jset('steady.ui', ui); open(function () { return vDay(d); }); });
function calendar(its) {
  var m = ui.amonth || today().slice(0, 7), first = new Date(m + '-01T12:00:00'), y = first.getFullYear(), mi = first.getMonth(), nd = new Date(y, mi + 1, 0).getDate(), by = {};
  its.forEach(function (i) { (by[i.day] = by[i.day] || []).push(i); });
  var o = '<div class="calhead"><button class="btn small ghost" data-do="amonth" data-arg="-1">\u2039 Earlier</button><b>' + esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</b><button class="btn small ghost" data-do="amonth" data-arg="1"' + (m >= today().slice(0, 7) ? ' disabled' : '') + '>Later \u203A</button></div>' +
    '<div class="cal">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (d) { return '<span class="dow">' + d + '</span>'; }).join('');
  for (var i = 0; i < first.getDay(); i++) o += '<span></span>';
  for (var dd = 1; dd <= nd; dd++) { var s = m + '-' + pad(dd), x = by[s] || [];
    o += '<button class="cd' + (s === today() ? ' today' : '') + (x.length ? ' has' : '') + '" data-do="openDay" data-arg="' + s + '"' + (s > today() ? ' disabled' : '') + ' aria-label="' + esc(longDay(s)) + ', ' + plural(x.length, 'entry', 'entries') + '"><span>' + dd + '</span>' + (x.length ? dots(uniqWho(x)) : '') + '</button>'; }
  o += '</div><p class="legend">' + kids().concat(['Me']).map(function (k) { return '<span><i style="background:' + accent(k) + '"></i>' + esc(k) + '</span>'; }).join('') + '</p>';
  var mc = its.filter(function (i) { return i.day.slice(0, 7) === m; });
  o += '<p class="count">' + plural(mc.length, 'entry', 'entries') + ' in ' + esc(first.toLocaleDateString(undefined, { month: 'long' })) + '</p>' + (mc.length ? grouped(mc) : '');
  return o;
}
on('amonth', function (dlt) { var m = ui.amonth || today().slice(0, 7), d = new Date(m + '-15T12:00:00'); d.setMonth(d.getMonth() + (+dlt)); ui.amonth = ymd(d).slice(0, 7); jset('steady.ui', ui); render(); });
on('openDay', function (s) { open(function () { return vDay(s); }); window.scrollTo(0, 0); });
function vDay(s) {
  var its = filtered({ who: [], types: [], q: '' }).filter(function (i) { return i.day === s; }), d = new Date(s + 'T12:00:00');
  var prev = new Date(d), next = new Date(d); prev.setDate(d.getDate() - 1); next.setDate(d.getDate() + 1);
  var o = '<div class="page"><div class="bar"><button class="link back" data-do="closeO">\u2190 Back</button></div>' +
    '<header class="ph"><p class="date">' + esc(d.toLocaleDateString(undefined, { weekday: 'long' }) + ' \u00b7 ' + d.getFullYear()) + (niceDate(s) === 'Today' || niceDate(s) === 'Yesterday' ? ' \u00b7 ' + niceDate(s) : '') + '</p><h1>' + esc(d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })) + '</h1>' +
    '<p class="lead">' + (its.length ? plural(its.length, 'entry', 'entries') + ' \u00b7 ' + esc(whoText(uniqWho(its))) : 'Nothing written this day.') + '</p></header>' +
    '<div class="daynav"><button class="btn small ghost" data-do="openDay" data-arg="' + ymd(prev) + '">\u2039 Previous day</button><button class="btn small ghost" data-do="openDay" data-arg="' + ymd(next) + '"' + (ymd(next) > today() ? ' disabled' : '') + '>Next day \u203A</button></div>';
  if (s === today() && !isShabbat(NOW())) o += '<button class="btn" data-do="journal" data-arg="' + (NOW().getHours() < 15 ? 'am' : 'pm') + '">Write in today\u2019s journal</button>';
  uniqWho(its).forEach(function (w) { var mine = its.filter(function (i) { return uniqWho([i])[0] === w; });
    if (!mine.length) return; var mem = mine.filter(function (i) { return i.thumb; });
    o += '<section class="dgroup"><h2 class="bh"><span>' + esc(w) + '</span><em>' + plural(mine.length, 'entry', 'entries') + '</em></h2>' +
      (mem.length ? '<div class="mgrid">' + mem.map(function (i) { return '<button class="th" data-do="openMem" data-arg="' + i.id + '" aria-label="Open memory" style="background-image:url(' + esc(i.thumb) + ')">' + (i.video ? '<b>Video</b>' : '') + '</button>'; }).join('') + '</div>' : '') +
      mine.filter(function (i) { return !i.thumb; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).map(function (i) { return card(i); }).join('') + '</section>'; });
  return o + '</div>';
}
$app.addEventListener('input', function (ev) { if (ev.target.id !== 'asearch') return; var f = af(); f.q = ev.target.value; ui.af = f; ui.fopen = true; jset('steady.ui', ui); var r = document.getElementById('ares'); if (r) { r.innerHTML = (ui.aview === 'cal' ? calendar : feed)(filtered()); bindAll(); } });

/* Today */
function vHome() {
  var d = NOW(), q = isShabbat(d), ai = allItems(), td = ai.filter(function (i) { return i.day === today(); }), o = '';
  o += '<header class="ph hello"><p class="date">' + esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '</p><h1>' + greeting() + '.</h1></header>';
  o += journalCard(d) || (q ? '' : '<button class="card prompt-card" data-do="journal" data-arg="' + (d.getHours() < 15 ? 'am' : 'pm') + '"><p class="eyebrow">' + (d.getHours() < 15 ? 'Morning journal' : 'Evening journal') + '</p><p class="serif">' + (jToday('am') || jToday('pm') ? 'Add to today\u2019s journal' : 'A minute for your journal') + '</p><span class="go">Write \u203A</span></button>');
  o += '<div class="ptiles">' + kids().concat(['Me']).map(personTile).join('') + '</div>';
  var n = doneCount(), wait = V.katya.filter(function (k) { return k.status === 'waiting to send'; }).length, rep = V.katya.filter(function (k) { return k.reply; }).length;
  o += '<div class="tools">' +
    tool('tab', 'archive', 'Timeline', plural(ai.length, 'entry', 'entries')) +
    tool('tab', 'memories', 'Memories', plural(entries('memory').length, 'kept', 'kept')) +
    tool('tab', 'moment', 'Right now', 'A hard moment') +
    tool('tab', 'reflect', 'Reflect', n + ' of ' + P.length) +
    tool('tab', 'care', 'Care', 'For you') +
    (q ? '' : tool('do', 'ask', 'Ask Katya', wait ? wait + ' not sent yet' : rep ? plural(rep, 'reply', 'replies') : 'Write it out')) + '</div>';
  var th = (V.config.therapy || '').toLowerCase(), wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  if (th && th.indexOf(wd) === 0) o += '<div class="card soft"><p class="eyebrow">Tonight</p><p>' + esc(child()) + '\u2019s session is tonight. Be nearby and easy.</p></div>';
  if (td.length) o += '<section class="block"><h2 class="bh"><span>Today so far</span><button class="link" data-do="openDay" data-arg="' + today() + '">' + plural(td.length, 'entry', 'entries') + ' \u203A</button></h2>' + td.slice(0, 3).map(function (i) { return card(i); }).join('') + '</section>';
  var otd = onThisDay(); if (otd) o += '<section class="block"><h2 class="bh"><span>' + otd.label + '</span><em>' + esc(niceDate(otd.it.day)) + '</em></h2>' + card(otd.it, true) + '</section>';
  var cr = credits(); if (cr.length) { var c = pick(cr, today() + 'c'); o += '<div class="card credit"><p class="eyebrow">Remember</p><p class="serif">' + esc(c.t) + '</p><p class="small">' + esc(c.src) + '</p></div>'; }
  if (!standalone() && !ui.noInstall) o += '<div class="card soft"><p class="eyebrow">Keep it on your home screen</p><p class="small">' + (/iphone|ipad/i.test(navigator.userAgent) ? 'Safari \u2192 Share \u2192 Add to Home Screen' : 'Browser menu \u2192 Add to Home screen') + '</p><div class="row2">' + (deferred ? '<button class="btn small" data-do="install">Install</button>' : '') + '<button class="btn small ghost" data-do="noInstall">Not now</button></div></div>';
  return o;
}
function tool(kind, target, label, sub) { return '<button class="tool" ' + (kind === 'tab' ? 'data-tab' : 'data-do') + '="' + target + '"><b>' + esc(label) + '</b><small>' + esc(sub) + '</small></button>'; }
function personTile(k) {
  var me = k === 'Me', a = ages()[k], its = allItems().filter(function (i) { return i.who.indexOf(k) >= 0; }), last = its[0];
  var line = last ? (last.day === today() ? 'Today' : niceDate(last.day)) : 'Nothing yet';
  return '<button class="ptile" style="--pc:' + accent(k) + '" data-do="portal" data-arg="' + esc(k) + '">' + avatar(k, 'lg') + '<b>' + esc(k) + '</b><small>' + (a ? esc(plural(a, 'year')) + ' \u00b7 ' : '') + esc(line) + '</small></button>';
}
/* person page */
var SECS = { notice: ['', 'Noticed'], needs: ['', 'Needs'], mem: ['', 'Memories'], moments: ['', 'Moments'], journal: ['', 'Journal'], letter: ['', 'Letter'], kind: ['', 'Kindness'], talk: ['', 'Self-talk'], wins: ['', 'Wins'] };
function tile(k, s, count, preview, extra) { return '<button class="tile" data-do="sec" data-arg="' + s + '"><b>' + SECS[s][1] + '<em>' + (count ? count : '') + '</em></b>' + (extra || '') + '<small>' + esc(cut(preview, 52)) + '</small></button>'; }
function vPortal() {
  var k = portal(), a = ages()[k], me = k === 'Me', q = isShabbat(NOW()), o = bubbles(k);
  o += '<header class="phead">' + avatar(k, 'xl') + '<div><h1>' + (me ? 'You' : esc(k)) + '</h1>' + (!me && a ? '<p class="lead">' + plural(a, 'year') + ' old</p>' : '') + '</div></header>';
  if (q) o += '<p class="quiet">Shabbat \u00b7 just for reading</p>';
  var ms = memories(k), lm = ms[0];
  o += '<div class="tiles">';
  if (!me) { var ls = loves(k), nd = forKid('need', k), mo = forKid('moment', k), js = journalFor(k), lt = entries('letter').filter(function (l) { return l.data.kid === k; });
    o += tile(k, 'mem', ms.length, lm ? lm.data.note || niceDate(lm.data.date) : 'Add the first one', strip(k)) + tile(k, 'notice', ls.length, ls[0] ? ls[0].data.text : 'What you see in them') +
      tile(k, 'moments', mo.length, mo[0] ? (mo[0].data.tag || mo[0].data.text) : 'Small counts') + tile(k, 'needs', nd.length, nd[0] ? nd[0].data.text : 'In this season') +
      tile(k, 'journal', js.length, js[0] ? niceDate(js[0].at) : 'Tag an entry') + tile(k, 'letter', lt.length, lt[0] ? (lt[0].data.occasion || 'Letter') : 'Words for them');
  } else { var sc = entries('selfcheck')[0], rf = entries('reframe'), ws = entries('win'), mn = forKid('need', 'Me'), mj = journalFor('Me');
    o += tile(k, 'kind', 0, sc && day(sc.at) === today() ? ({ gentle: 'Gently, today', okay: 'Getting by', hard: 'Hard on myself today' })[sc.data.tone] : pick(SELF, today() + 's')) +
      tile(k, 'talk', rf.length, rf[0] ? rf[0].data.text : 'Answer the harsh voice') + tile(k, 'wins', ws.length, ws[0] ? ws[0].data.label : 'It counts') +
      tile(k, 'needs', mn.length, mn[0] ? mn[0].data.text : 'Name one') + tile(k, 'mem', ms.length, lm ? lm.data.note || niceDate(lm.data.date) : 'Proud of myself', strip(k)) + tile(k, 'journal', mj.length, mj[0] ? niceDate(mj[0].at) : 'Your entries'); }
  o += '</div>';
  var its = allItems().filter(function (i) { return i.who.indexOf(k) >= 0; });
  o += '<button class="rowlink" data-do="personTimeline" data-arg="' + esc(k) + '"><span><b>' + (me ? 'Your timeline' : esc(k) + '\u2019s timeline') + '</b><small>' + plural(its.length, 'entry', 'entries') + ', by date</small></span><span class="chev" aria-hidden="true">\u203A</span></button>';
  return o;
}
on('personTimeline', function (k) { ui.af = { who: [k], types: [], q: '' }; ui.aview = 'feed'; jset('steady.ui', ui); go('archive'); });

/* clean versions without symbol icons */
function vMoment() {
  return '<header class="ph"><h1>Right now</h1></header><div class="stack">' +
    HELP.map(function (h) { return '<button class="rn" data-do="help" data-arg="' + h[0] + '"><span><b>' + esc(fill(h[1])) + '</b><small>' + esc(h[2]) + '</small></span><span class="chev" aria-hidden="true">\u203A</span></button>'; }).join('') + '</div>' +
    (isShabbat(NOW()) ? '' : '<button class="btn ghost" data-do="ask">Ask Katya</button>');
}
function vCare() {
  var plan = entries('plan')[0], pi = plan ? plan.data.items : [], cr = credits();
  return '<header class="ph"><h1>Care</h1></header><div class="tiles">' +
    '<button class="tile" data-do="care" data-arg="plan"><b>Self-care plan<em>' + (pi.length || '') + '</em></b><small>' + esc(cut(pi[0] || 'A few small, real things', 52)) + '</small></button>' +
    '<button class="tile" data-do="care" data-arg="remember"><b>Remember<em>' + (cr.length || '') + '</em></b><small>' + esc(cut(cr[0] ? cr[0].t : 'What you give them', 52)) + '</small></button>' +
    '<button class="tile" data-do="care" data-arg="kinder"><b>Kinder voice</b><small>' + esc(cut(reframe(), 52)) + '</small></button>' +
    '<button class="tile" data-do="portal" data-arg="Me"><b>My page</b><small>Wins, needs, self-talk</small></button></div>' +
    '<button class="btn" data-do="careTimeline">Care notes by date</button>';
}
on('careTimeline', function () { ui.af = { who: [], types: ['care', 'win'], q: '' }; ui.aview = 'feed'; jset('steady.ui', ui); go('archive'); });
function vCareSec(s) {
  var o = '<div class="page"><div class="bar"><button class="link back" data-do="closeO">\u2190 Care</button></div>';
  if (s === 'plan') { var plan = entries('plan')[0], pi = plan ? plan.data.items : [], seeds = items(5).concat(items(6)).filter(function (x) { return pi.indexOf(x) < 0; });
    o += '<h1>Self-care plan</h1>' + (pi.length ? '<ul class="plan">' + pi.map(function (x, i) { return '<li><span>' + esc(x) + '</span><button class="x" data-do="rmPlan" data-arg="' + i + '">Remove</button></li>'; }).join('') + '</ul>' : '<p class="empty">A few small, real things that fill you up.</p>') +
      (seeds.length ? '<p class="lbl">From your answers</p><div class="chips">' + seeds.slice(0, 6).map(function (x) { return '<button class="chip" data-do="addPlan" data-arg="' + esc(x) + '">Add: ' + esc(x) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="inline"><input id="planx" placeholder="Add something" aria-label="Add to plan"><button class="btn small" data-do="planx">Add</button></div>'; }
  if (s === 'remember') { var cr = credits(); o += '<h1>Remember</h1>' + (cr.length ? '<ul class="wall">' + cr.slice(0, 30).map(function (c) { return '<li><span>' + esc(c.t) + '</span><small>' + esc(c.src) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">Answer reflections 1 and 2 to start this. <a href="#" data-do="gotoQ" data-arg="0">Start</a></p>'); }
  if (s === 'kinder') { var harsh = latest(2).trim(); o += '<h1>Kinder voice</h1>' + (harsh ? '<p class="quote">' + nl(harsh) + '</p>' : '') + '<div class="script"><p class="serif">' + esc(reframe()) + '</p></div>' +
    '<textarea id="ref" rows="3" placeholder="In your own words" aria-label="Kinder version"></textarea><button class="btn primary" data-do="saveRef">Keep this version</button>'; }
  return o + '</div>';
}
function vReflect() {
  var n = doneCount(), sec = ui.rsec === 'child' ? 'child' : 'you', o = '<header class="ph"><h1>Reflect</h1><p class="lead">' + n + ' of ' + P.length + ' answered</p></header>';
  if (n < P.length) o += '<button class="btn primary" data-do="resume">' + (n ? 'Continue where I left off' : 'Begin') + '</button>';
  o += '<div class="seg" role="tablist" aria-label="Section">' + ['you', 'child'].map(function (x) { return '<button role="tab" class="' + (x === sec ? 'on' : '') + '" aria-selected="' + (x === sec) + '" data-do="rsec" data-arg="' + x + '">' + esc(x === 'you' ? 'For you' : 'For ' + child()) + '</button>'; }).join('') + '</div><div class="stack">';
  P.forEach(function (p, i) { if (p.s !== sec) return; var a = ans(i), t = latest(i);
    o += '<button class="rq' + (t ? ' done' : '') + '" data-do="gotoQ" data-arg="' + i + '"><span><small class="st">' + (i + 1) + ' \u00b7 ' + (t ? 'Answered ' + esc(niceDate(a[a.length - 1].at)) : drafts[i] ? 'Draft' : 'Not yet') + '</small><b>' + esc(fill(p.t)) + '</b>' + (t ? '<small>' + esc(cut(t, 90)) + '</small>' : '') + '</span></button>'; });
  o += '</div><button class="btn ghost" data-do="reflTimeline">My answers by date</button>';
  return o;
}
on('rsec', function (x) { ui.rsec = x; jset('steady.ui', ui); render(); });
on('reflTimeline', function () { ui.af = { who: [], types: ['reflect'], q: '' }; ui.aview = 'feed'; jset('steady.ui', ui); go('archive'); });
function journalCard(d) {
  if (isShabbat(d)) return '<div class="card prompt-card shab"><p class="eyebrow">Shabbat</p><p class="serif">Nothing to fill in. Just be with them.</p></div>';
  var h = d.getHours();
  if (h >= 5 && h < 12 && !jToday('am')) return '<button class="card prompt-card" data-do="journal" data-arg="am"><p class="eyebrow">Morning journal \u00b7 about a minute</p><p class="serif">Who do you want to be with the kids today?</p><span class="go">Write \u203A</span></button>';
  if ((h >= 20 || h < 3) && !jToday('pm')) return '<button class="card prompt-card eve" data-do="journal" data-arg="pm"><p class="eyebrow">Evening journal \u00b7 two minutes</p><p class="serif">What went right today?</p><span class="go">Write \u203A</span></button>';
  return '';
}

/* ---------- start ---------- */
V = view();
if (K && !ui.welcomed) overlay = vWelcome;
render();
if (K) flush(true);
setInterval(function () { if (K && document.visibilityState === 'visible') flush(true); }, 120000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && K) flush(true); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
