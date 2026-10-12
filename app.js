(function () {
'use strict';
var P = window.STEADY_PROMPTS, SEC = window.STEADY_SECTIONS, $app = document.getElementById('app');
var LS = localStorage, K = LS.getItem('steady.k'), API = LS.getItem('steady.api') || (window.STEADY_CONFIG || {}).API_URL || '';
function jget(k, d) { try { var v = JSON.parse(LS.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function jset(k, v) { LS.setItem(k, JSON.stringify(v)); }
var snap = jget('steady.snap', { config: {}, answers: [], entries: [], katya: [] }), queue = jget('steady.q', []), drafts = jget('steady.drafts', {}), ui = jget('steady.ui', { lastQ: 0 });
var sync = { state: API ? 'idle' : 'local', msg: '' };
var route = { tab: 'today' }, overlay = null;

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function nl(s) { return esc(s).replace(/\n/g, '<br>'); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function nowStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function day(s) { return String(s || '').slice(0, 10); }
function today() { return day(nowStr()); }
function daysAgo(s) { return Math.floor((new Date(today()) - new Date(day(s))) / 864e5); }
function niceDate(s) { var d = new Date(String(s).slice(0, 10) + 'T12:00:00'); if (isNaN(d)) return ''; var n = daysAgo(s); return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
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
      sync.state = 'ok'; sync.at = nowStr();
    })
    .catch(function (e) { sync.state = 'offline'; sync.msg = String(e.message || e); })
    .then(function () { flushing = false; V = view(); var a = document.activeElement; if (!a || !/TEXTAREA|INPUT/.test(a.tagName)) render(); if (queue.length && sync.state === 'ok') flush(); });
}

/* ---------- shell ---------- */
var TABS = [['today', 'Today', '\u2600'], ['moment', 'Right now', '\u2766'], ['moments', 'Moments', '\u2727'], ['care', 'Care', '\u2661'], ['reflect', 'Reflect', '\u270E']];
function syncLine() {
  var n = queue.length;
  if (sync.state === 'local') return 'Saved on this phone only';
  if (n && sync.state === 'offline') return 'Saved on this phone \u00b7 will sync when it can';
  if (sync.state === 'syncing') return 'Saving privately\u2026';
  return 'Saved privately';
}
function render() {
  V = view();
  if (!K) { $app.innerHTML = '<div class="locked"><div class="sun"></div><h1>Steady</h1><p>This is a private app. Open it from your personal link.</p></div>'; return; }
  if (overlay) { $app.innerHTML = overlay(); bindAll(); return; }
  var body = ({ today: vToday, moment: vMoment, moments: vMoments, care: vCare, reflect: vReflect })[route.tab]();
  $app.innerHTML = '<main class="page">' + body + '<p class="sync">' + esc(syncLine()) + '</p></main><nav class="tabs">' + TABS.map(function (t) {
    return '<button data-tab="' + t[0] + '" class="' + (route.tab === t[0] ? 'on' : '') + '"><span>' + t[2] + '</span>' + t[1] + '</button>'; }).join('') + '</nav>';
  bindAll();
}
function go(tab) { route = { tab: tab }; overlay = null; render(); window.scrollTo(0, 0); }
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
    '<p>These are seventeen questions to sit with, one at a time. There are no right answers and no deadline.</p>' +
    '<p>Write as much or as little as you like. Skip any of them. Everything saves as you go, and you can come back and change your mind whenever you want.</p>' +
    '<p>Each answer quietly shapes the rest of the app: the words you use, the ideas it offers, the reminders it gives you.</p>' +
    '<p class="small">Only you can see what you write.</p>' +
    '<button class="btn primary" data-do="startIntake">Begin</button><button class="btn ghost" data-do="skipIntro">Look around first</button></div>';
}
on('startIntake', function () { ui.welcomed = true; jset('steady.ui', ui); openQ(answered(ui.lastQ || 0) ? Math.max(0, nextOpen(ui.lastQ || 0)) : (ui.lastQ || 0)); });
on('skipIntro', function () { ui.welcomed = true; jset('steady.ui', ui); close(); });

function openQ(q) { ui.lastQ = q; jset('steady.ui', ui); open(function () { return vPrompt(q); }); }
function vPrompt(q) {
  var p = P[q], val = drafts[q] != null ? drafts[q] : latest(q), first = q === 0 || P[q - 1].s !== p.s, hist = ans(q);
  var ph = p.three ? '1.\n2.\n3.' : p.list ? 'One idea per line' : 'Whatever comes to mind\u2026';
  return '<div class="prompt">' +
    '<div class="ptop"><button class="link" data-do="pauseQ">\u2190 Pause</button><span>' + (q + 1) + ' of ' + P.length + '</span></div>' +
    '<div class="dots">' + P.map(function (_, i) { return '<i class="' + (i === q ? 'cur ' : '') + (answered(i) ? 'done' : '') + '"></i>'; }).join('') + '</div>' +
    '<p class="sec">' + esc(fill(SEC[p.s])) + '</p>' +
    '<h2 class="ptext">' + esc(fill(p.t)) + '</h2>' +
    '<details class="why"' + (first ? '' : '') + '><summary>Why this matters</summary><p>' + esc(fill(p.n)) + '</p></details>' +
    '<textarea data-q="' + q + '" rows="9" placeholder="' + esc(ph) + '">' + esc(val) + '</textarea>' +
    '<p class="saved">' + (hist.length ? 'Last saved ' + esc(niceDate(hist[hist.length - 1].at)) + (hist.length > 1 ? ' \u00b7 ' + hist.length + ' versions' : '') : 'Nothing saved yet. Take a breath first if you like.') + '</p>' +
    '<button class="btn primary" data-do="saveNext" data-arg="' + q + '">Save and continue</button>' +
    '<div class="row2"><button class="btn ghost" data-do="prevQ" data-arg="' + q + '"' + (q === 0 ? ' disabled' : '') + '>Back</button><button class="btn ghost" data-do="skipQ" data-arg="' + q + '">Come back to this later</button></div>' +
    '</div>';
}
function curText() { var t = $app.querySelector('textarea[data-q]'); return t ? t.value : ''; }
on('saveNext', function (q) { q = +q; var t = curText(); if (saveAnswer(q, t)) toast('Saved'); if (q + 1 >= P.length) { var n = nextOpen(q); if (n < 0) { open(vAllDone); return; } openQ(n); } else openQ(q + 1); });
on('skipQ', function (q) { q = +q; var t = curText(); if (t.trim()) { drafts[q] = t; jset('steady.drafts', drafts); } if (q + 1 < P.length) openQ(q + 1); else { var n = nextOpen(q); n < 0 || n === q ? open(vAllDone) : openQ(n); } });
on('prevQ', function (q) { q = +q; var t = curText(); if (t.trim() && t !== latest(q)) { drafts[q] = t; jset('steady.drafts', drafts); } if (q > 0) openQ(q - 1); });
on('pauseQ', function () { var t = $app.querySelector('textarea[data-q]'); if (t && t.value.trim() && t.value !== latest(+t.dataset.q)) saveAnswer(+t.dataset.q, t.value); toast('Saved. Come back whenever you like.'); go(route.tab || 'today'); });
function vAllDone() { return '<div class="intro"><div class="sun big"></div><h1>That was a lot to sit with.</h1><p>Thank you for giving it the time. You can come back to any of these whenever you like. Your answers will look different in a few months, and that is good.</p><button class="btn primary" data-do="home">Go to Today</button></div>'; }
on('home', function () { go('today'); });

/* ---------- Today ---------- */
function greeting() { var h = new Date().getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function credits() {
  var c = items(1).map(function (t) { return { t: t, src: 'You give them' }; });
  var p = latest(0).trim(); if (p) c.unshift({ t: p, src: 'What you are proud of' });
  entries('win').slice(0, 30).forEach(function (w) { c.push({ t: w.data.label, src: niceDate(w.at) }); });
  return c;
}
var WINS = ['Stayed calm', 'Gave space', 'Showed up', 'Made them laugh', 'Repaired after a hard moment', 'Held a limit kindly', 'Said I love you', 'Took care of myself'];
function winsToday() { return entries('win').filter(function (w) { return day(w.at) === today(); }); }
function oneOnOneIdeas() {
  var a = items(12).concat(items(11)), seen = {};
  a = a.filter(function (x) { var k = x.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
  return a.length ? a : ['A drive together, music of her choice', 'Get a treat, just the two of you', 'Walk around the block after dinner', 'Ask her to teach you something she likes', 'Sit with her while she does her thing'];
}
function careItems() { var a = []; var plan = entries('plan')[0]; if (plan) a = a.concat(plan.data.items || []); return a.concat(items(5), items(6)).filter(Boolean); }
function vToday() {
  var d = new Date(), h = d.getHours() + d.getMinutes() / 60, n = doneCount(), cr = credits(), out = '';
  out += '<header class="hello"><p class="date">' + esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '</p><h1>' + greeting() + '.</h1></header>';
  if (n < P.length) {
    var nq = drafts[ui.lastQ] != null || !answered(ui.lastQ) ? ui.lastQ : nextOpen(ui.lastQ);
    out += '<button class="card reflect-card" data-do="resume"><p class="eyebrow">Reflect \u00b7 ' + n + ' of ' + P.length + '</p><p class="serif">' + esc(fill(P[nq].t)) + '</p><p class="small">' + (n ? 'Pick up where you left off' : 'Start whenever you\u2019re ready. One question is plenty.') + ' \u2192</p></button>';
  }
  if (h >= 17.5 && h < 20) out += '<div class="card soft"><p class="eyebrow">Family time</p><p>You don\u2019t need a perfect evening. One small moment is enough.</p></div>';
  var th = (V.config.therapy || '').toLowerCase(), wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  if (th && th.indexOf(wd) === 0) out += '<div class="card soft"><p class="eyebrow">Tonight</p><p>' + esc(child()) + ' has her session tonight. Afterward she may want quiet. Be nearby and easy. No questions needed.</p></div>';
  var last1 = entries('moment').filter(function (m) { return m.data.tag === 'One-on-one' && m.data.kid === child(); })[0];
  if (!last1 || daysAgo(last1.at) >= 7) { var idea = pick(oneOnOneIdeas()); out += '<div class="card"><p class="eyebrow">This week</p><p>Some time with ' + esc(child()) + ' that\u2019s just about enjoying each other.</p><p class="idea">\u201c' + esc(idea) + '\u201d</p><button class="btn small" data-do="logOne">We did something</button></div>'; }
  if (cr.length) { var c = pick(cr, today() + 'c'); out += '<div class="card credit"><p class="eyebrow">Remember this</p><p class="serif">' + esc(c.t) + '</p><p class="small">' + esc(c.src) + '</p></div>'; }
  var ci = careItems(); if (ci.length) out += '<div class="card"><p class="eyebrow">For you today</p><p>' + esc(pick(ci, today() + 'k')) + '</p><p class="small">Caring for yourself is part of caring for them.</p></div>';
  var w = winsToday();
  out += '<div class="card"><p class="eyebrow">Did well today' + (w.length ? ' \u00b7 ' + w.length : '') + '</p><div class="chips">' + WINS.slice(0, 6).map(function (x) { return '<button class="chip" data-do="win" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
    (w.length ? '<p class="small">' + w.map(function (x) { return esc(x.data.label); }).join(' \u00b7 ') + '</p>' : '<p class="small">Tap anything that\u2019s true. It counts.</p>') + '</div>';
  if (!standalone() && !ui.noInstall) out += '<div class="card soft"><p class="eyebrow">Keep it on your home screen</p><p class="small">' + (/iphone|ipad/i.test(navigator.userAgent) ? 'In Safari, tap Share, then \u201cAdd to Home Screen\u201d.' : 'Tap Install, or use the browser menu \u2192 \u201cAdd to Home screen\u201d.') + '</p><div class="row2">' + (deferred ? '<button class="btn small" data-do="install">Install</button>' : '') + '<button class="btn small ghost" data-do="noInstall">Not now</button></div></div>';
  out += '<div class="quick"><button class="btn" data-tab="moment">I need a moment</button><button class="btn" data-do="ask">Ask Katya</button></div>';
  return out;
}
on('resume', function () { var q = drafts[ui.lastQ] != null || !answered(ui.lastQ) ? ui.lastQ : nextOpen(ui.lastQ); openQ(q < 0 ? 0 : q); });
on('win', function (label) { entry('win', { label: label }); toast('Counted. \u2714'); render(); });
on('logOne', function () { route = { tab: 'moments', preset: { kid: child(), tag: 'One-on-one' } }; render(); });

/* ---------- In the moment ---------- */
var HELP = [
  ['quiet', '{c} is closed off', 'Give space without reading it as rejection'],
  ['limit', 'I need to hold a limit', 'Her feelings make sense. The boundary stays.'],
  ['messed', 'I think I messed up', 'Talk to yourself like someone you love'],
  ['racing', 'My mind is racing', 'Slow down, set it down, one small step']
];
function vMoment() {
  return '<header class="hello"><h1>Right now</h1><p>Take one breath. Then pick what\u2019s happening.</p></header>' +
    HELP.map(function (h) { return '<button class="card helper" data-do="help" data-arg="' + h[0] + '"><p class="serif">' + esc(fill(h[1])) + '</p><p class="small">' + esc(h[2]) + '</p></button>'; }).join('') +
    '<p class="small center">Want to talk something through? <a href="#" data-do="ask">Ask Katya</a></p>';
}
on('help', function (k) { open(function () { return vHelp(k); }); });
function yours(q, label) { var t = latest(q).trim(); return t ? '<div class="yours"><p class="eyebrow">' + esc(label) + '</p><p>' + nl(t) + '</p></div>' : '<p class="small">Answer reflection ' + (q + 1) + ' and your own words will show up here. <a href="#" data-do="gotoQ" data-arg="' + q + '">Answer it</a></p>'; }
on('gotoQ', function (q) { openQ(+q); });
function back() { return '<div class="ptop"><button class="link" data-do="closeO">\u2190 Back</button></div>'; }
on('closeO', function () { close(); });
function vHelp(k) {
  var c = esc(child()), o = back();
  if (k === 'quiet') {
    o += '<h1>' + c + ' is closed off</h1><div class="breath">Breathe in\u2026 and out. Her quiet is about what she\u2019s carrying, not about you.</div>' +
      '<div class="script"><p class="eyebrow">You could say</p><p class="serif">\u201cYou don\u2019t have to talk right now. I\u2019m here whenever you want.\u201d</p><p class="small">Then let it be. Stay nearby, keep it easy. Offer a snack or a ride, not a question.</p></div>' +
      yours(10, 'In your own words') + yours(8, 'What usually comes up in you') +
      '<div class="card soft"><p>That feeling is real, and it\u2019s not a verdict on your relationship. Space is part of how she grows.</p></div>' + yours(11, 'When she tends to open up');
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
    o += '<h1>Your mind is racing</h1><div class="breath">Three slow breaths. Feel your feet on the floor.</div>' + yours(4, 'What it\u2019s usually trying to solve') +
      '<label class="lbl" for="park">Set it down here</label><textarea id="park" rows="3" placeholder="What\u2019s spinning? Write it, then let the page hold it."></textarea><button class="btn small" data-do="park">Set it down</button>' +
      '<div class="card soft"><p><b>Is this mine to solve tonight?</b> If not, it can wait on the page. If yes, what is one small next step?</p></div>' + yours(7, 'What you gave yourself permission to do');
    var pk = entries('parked').slice(0, 3); if (pk.length) o += '<p class="eyebrow">Recently set down</p>' + pk.map(function (p) { return '<p class="small">' + esc(niceDate(p.at)) + ': ' + esc(p.data.text) + '</p>'; }).join('');
  }
  return '<div class="page">' + o + '<button class="btn ghost" data-do="ask">Ask Katya about this</button></div>';
}
function reframe() {
  var r = entries('reframe')[0]; if (r) return r.data.text;
  return 'You care so much that you\u2019re still thinking about it. That\u2019s what a good father does. You can make it right, and one hard moment doesn\u2019t undo all the love you give them.';
}
on('feel', function (f) { ui.limitFeel = f; ui.limitText = ($app.querySelector('#lim') || {}).value || ui.limitText; jset('steady.ui', ui); render(); });
on('buildLimit', function () { ui.limitText = $app.querySelector('#lim').value.trim(); jset('steady.ui', ui); render(); });
on('park', function () { var t = $app.querySelector('#park').value.trim(); if (!t) return; entry('parked', { text: t }); toast('Set down. It\u2019ll keep.'); render(); });

/* ---------- Small moments ---------- */
var TAGS = ['One-on-one', 'We laughed', 'Opened up', 'Just together', 'Repaired'];
function vMoments() {
  var pre = route.preset || {}, ms = entries('moment'), wk = ms.filter(function (m) { return daysAgo(m.at) < 7; }).length, kd = pre.kid || ui.kid || child();
  var o = '<header class="hello"><h1>Small moments</h1><p>Connection is built in many small moments, not one perfect talk.</p></header>' +
    '<div class="card"><p class="eyebrow">Log a moment</p><div class="chips">' + kids().map(function (k) { return '<button class="chip' + (k === kd ? ' on' : '') + '" data-do="kid" data-arg="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' +
    '<textarea id="mtext" rows="3" placeholder="What happened? Even a minute counts."></textarea>' +
    '<div class="chips">' + TAGS.map(function (t) { return '<button class="chip tag' + (t === pre.tag ? ' on' : '') + '" data-do="tag" data-arg="' + t + '">' + t + '</button>'; }).join('') + '</div>' +
    '<button class="btn primary" data-do="saveMoment">Save moment</button></div>' +
    '<p class="count">' + (wk ? wk + ' small moment' + (wk > 1 ? 's' : '') + ' this week' : 'None logged this week yet. They still happened.') + '</p>' +
    '<div class="card"><p class="eyebrow">One-on-one ideas with ' + esc(child()) + '</p><ul class="ideas">' + oneOnOneIdeas().slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
    (items(12).length || items(11).length ? '<p class="small">From your own answers.</p>' : '<p class="small">Starter ideas. <a href="#" data-do="gotoQ" data-arg="12">Add your own</a></p>') + '</div>';
  o += ms.slice(0, 40).map(function (m) { return '<div class="moment"><p class="small">' + esc(niceDate(m.at)) + ' \u00b7 ' + esc(m.data.kid) + (m.data.tag ? ' \u00b7 ' + esc(m.data.tag) : '') + '</p><p>' + nl(m.data.text) + '</p></div>'; }).join('');
  return o;
}
on('kid', function (k) { var t = $app.querySelector('#mtext').value; ui.kid = k; jset('steady.ui', ui); route.preset = Object.assign({}, route.preset, { kid: k }); render(); $app.querySelector('#mtext').value = t; });
on('tag', function (t, b) { var on_ = b.classList.contains('on'); $app.querySelectorAll('.chip.tag').forEach(function (x) { x.classList.remove('on'); }); if (!on_) b.classList.add('on'); route.preset = Object.assign({}, route.preset, { tag: on_ ? '' : t }); });
on('saveMoment', function () { var t = $app.querySelector('#mtext').value.trim(); var tg = $app.querySelector('.chip.tag.on'); if (!t && !tg) { toast('Write a few words or pick a tag'); return; }
  entry('moment', { kid: (route.preset || {}).kid || ui.kid || child(), text: t, tag: tg ? tg.dataset.arg : '' }); route.preset = {}; toast('Saved. That mattered.'); render(); });

/* ---------- Care: self-compassion + self-care ---------- */
function vCare() {
  var ws = entries('win'), wk = ws.filter(function (w) { return daysAgo(w.at) < 7; }), harsh = latest(2).trim(), plan = entries('plan')[0], pi = plan ? plan.data.items : [];
  var seeds = items(5).concat(items(6)).filter(function (x) { return pi.indexOf(x) < 0; });
  var o = '<header class="hello"><h1>Care</h1><p>Pouring into yourself is how you keep pouring into them.</p></header>';
  o += '<div class="card"><p class="eyebrow">Did well \u00b7 ' + winsToday().length + ' today \u00b7 ' + wk.length + ' this week</p><div class="chips">' + WINS.map(function (x) { return '<button class="chip" data-do="win" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
    '<div class="inline"><input id="winx" placeholder="Something else I did well"><button class="btn small" data-do="winx">Add</button></div></div>';
  o += '<div class="card credit"><p class="eyebrow">Remember this</p>' + (credits().length ? '<ul class="wall">' + credits().slice(0, 12).map(function (c) { return '<li><span>' + esc(c.t) + '</span><small>' + esc(c.src) + '</small></li>'; }).join('') + '</ul>' : '<p class="small">Your answers to reflections 1 and 2 will live here. <a href="#" data-do="gotoQ" data-arg="0">Start</a></p>') + '</div>';
  o += '<div class="card"><p class="eyebrow">A kinder voice</p>' + (harsh ? '<p class="small">When you slip, you tend to tell yourself:</p><p class="quote">' + nl(harsh) + '</p><p class="small">Would you say that to someone you love? Here\u2019s what you might say to them:</p>' : '<p class="small">Reflection 3 asks how you talk to yourself after a hard moment. <a href="#" data-do="gotoQ" data-arg="2">Answer it</a></p>') +
    '<p class="serif">' + esc(reframe()) + '</p><textarea id="ref" rows="3" placeholder="Rewrite it in your own words, the way you\u2019d say it to a friend"></textarea><button class="btn small" data-do="saveRef">Keep this version</button></div>';
  o += '<div class="card"><p class="eyebrow">My self-care plan</p>' + (pi.length ? '<ul class="plan">' + pi.map(function (x, i) { return '<li><span>' + esc(x) + '</span><button class="x" data-do="rmPlan" data-arg="' + i + '" aria-label="Remove">\u00d7</button></li>'; }).join('') + '</ul>' : '<p class="small">A few small, real things that fill you up. Not a reward for finishing everything.</p>') +
    (seeds.length ? '<p class="small">From your answers \u2014 tap to add:</p><div class="chips">' + seeds.slice(0, 8).map(function (s) { return '<button class="chip" data-do="addPlan" data-arg="' + esc(s) + '">+ ' + esc(s) + '</button>'; }).join('') + '</div>' : '') +
    '<div class="inline"><input id="planx" placeholder="e.g. 20 minutes to myself after the kids are down"><button class="btn small" data-do="planx">Add</button></div>' + yours(7, 'What you gave yourself permission to do') + '</div>';
  return o;
}
on('winx', function () { var v = $app.querySelector('#winx').value.trim(); if (v) { entry('win', { label: v }); toast('Counted. \u2714'); render(); } });
on('saveRef', function () { var v = $app.querySelector('#ref').value.trim(); if (v) { entry('reframe', { text: v }); toast('Kept.'); render(); } });
function setPlan(list) { var p = entries('plan')[0]; entry('plan', { items: list }, p ? p.id : 'plan'); render(); }
on('addPlan', function (s) { var p = entries('plan')[0]; setPlan((p ? p.data.items : []).concat([s])); });
on('planx', function () { var v = $app.querySelector('#planx').value.trim(); if (v) { var p = entries('plan')[0]; setPlan((p ? p.data.items : []).concat([v])); } });
on('rmPlan', function (i) { var p = entries('plan')[0]; var l = p.data.items.slice(); l.splice(+i, 1); setPlan(l); });

/* ---------- Reflect / revisit ---------- */
function vReflect() {
  var n = doneCount(), o = '<header class="hello"><h1>Reflect</h1><p>' + n + ' of ' + P.length + ' answered. Any order, any time. Your answers are allowed to change.</p></header>';
  if (n < P.length) o += '<button class="btn primary" data-do="resume">' + (n ? 'Continue where I left off' : 'Begin') + '</button>';
  ['you', 'child'].forEach(function (s) {
    o += '<p class="sec">' + esc(fill(SEC[s])) + '</p>';
    P.forEach(function (p, i) { if (p.s !== s) return; var a = ans(i), t = latest(i);
      o += '<button class="card qcard' + (t ? '' : ' empty') + '" data-do="gotoQ" data-arg="' + i + '"><p class="small">' + (i + 1) + (a.length ? ' \u00b7 ' + esc(niceDate(a[a.length - 1].at)) + (a.length > 1 ? ' \u00b7 ' + a.length + ' versions' : '') : drafts[i] ? ' \u00b7 draft' : '') + '</p><p class="serif">' + esc(fill(p.t)) + '</p>' + (t ? '<p class="ans">' + esc(t.length > 160 ? t.slice(0, 160) + '\u2026' : t) + '</p>' : '') + '</button>' +
        (a.length > 1 ? '<details class="hist"><summary>Earlier answers</summary>' + a.slice(0, -1).reverse().map(function (x) { return '<p class="small">' + esc(niceDate(x.at)) + '</p><p>' + nl(x.text) + '</p>'; }).join('') + '</details>' : ''); });
  });
  o += '<button class="card" data-do="ask"><p class="eyebrow">Ask Katya</p><p>Write about a situation and get a thoughtful reply.</p></button>';
  return o;
}

/* ---------- Ask Katya ---------- */
on('ask', function () { open(vAsk); });
function vAsk() {
  var ks = V.katya.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return '<div class="page">' + back() + '<h1>Ask Katya</h1><p>Describe what happened or what you\u2019re worried about. Katya will read it and write back here with some support and ideas. It stays private.</p>' +
    '<textarea id="askt" rows="6" placeholder="Tonight she shut her door after dinner and I wasn\u2019t sure whether to knock\u2026"></textarea><button class="btn primary" data-do="sendAsk">Send to Katya</button>' +
    ks.map(function (k) { return '<div class="thread"><p class="small">' + esc(niceDate(k.at)) + '</p><p class="me">' + nl(k.text) + '</p>' + (k.reply ? '<p class="kat"><b>Katya</b><br>' + nl(k.reply) + '</p>' : '<p class="small">' + (k.status === 'waiting to send' ? 'Saved on this phone, sending when it can' : 'Katya will reply here') + '</p>') + '</div>'; }).join('') + '</div>';
}
on('sendAsk', function () { var t = $app.querySelector('#askt').value.trim(); if (!t) return; push({ t: 'ask', text: t }); toast('Sent to Katya'); render(); });

var deferred = null;
function standalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone; }
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; if (!overlay) render(); });
on('install', function () { if (deferred) { deferred.prompt(); deferred = null; } });
on('noInstall', function () { ui.noInstall = true; jset('steady.ui', ui); render(); });
/* ---------- start ---------- */
V = view();
if (K && !ui.welcomed) overlay = vWelcome;
render();
if (K) flush(true);
setInterval(function () { if (K && document.visibilityState === 'visible') flush(true); }, 120000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && K) flush(true); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
