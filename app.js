(function () {
'use strict';
var P = window.STEADY_PROMPTS, SEC = window.STEADY_SECTIONS, $app = document.getElementById('app');
var LS = localStorage, K = LS.getItem('steady.k'), API = LS.getItem('steady.api') || (window.STEADY_CONFIG || {}).API_URL || '';
function jget(k, d) { try { var v = JSON.parse(LS.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function jset(k, v) { LS.setItem(k, JSON.stringify(v)); }
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
      sync.state = 'ok'; sync.at = nowStr(); setTimeout(mediaFlush, 0);
    })
    .catch(function (e) { sync.state = 'offline'; sync.msg = String(e.message || e); })
    .then(function () { flushing = false; V = view(); var a = document.activeElement; if (!a || !/TEXTAREA|INPUT/.test(a.tagName)) render(); if (queue.length && sync.state === 'ok') flush(); });
}

/* ---------- shell ---------- */
var TABS = [['today', 'Today', '\u2600'], ['moment', 'Right now', '\u2766'], ['moments', 'Moments', '\u2727'], ['people', 'Portals', '\u25CE'], ['care', 'Care', '\u2661'], ['reflect', 'Reflect', '\u270E']];
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
  var body = ({ home: vHome, today: vHome, moment: vMoment, moments: vMoments, care: vCare, reflect: vReflect, people: vPortal, memories: vMemories, letters: vLetters, archive: vArchive })[route.tab]();
  var top = route.tab === 'home' || route.tab === 'today' ? '<div class="bar brand"><span class="sun tiny"></span><span>Steady</span></div>' : '<div class="bar"><button class="link" data-tab="home">\u2190 Home</button></div>';
  $app.innerHTML = '<main class="page">' + top + body + '<p class="sync">' + esc(syncLine()) + '</p></main>';
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
on('pauseQ', function () { var t = $app.querySelector('textarea[data-q]'); if (t && t.value.trim() && t.value !== latest(+t.dataset.q)) saveAnswer(+t.dataset.q, t.value); toast('Saved. Come back whenever you like.'); go(route.tab || 'home'); });
function vAllDone() { return '<div class="intro"><div class="sun big"></div><h1>That was a lot to sit with.</h1><p>Thank you for giving it the time. You can come back to any of these whenever you like. Your answers will look different in a few months, and that is good.</p><button class="btn primary" data-do="home">Go to Today</button></div>'; }
on('home', function () { go('home'); });

/* ---------- Today ---------- */
function greeting() { var h = NOW().getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function credits() {
  var c = items(1).map(function (t) { return { t: t, src: 'You give them' }; });
  var p = latest(0).trim(); if (p) c.unshift({ t: p, src: 'What you are proud of' });
  entries('journal').filter(function (j) { return j.data.kind === 'pm'; }).slice(0, 20).forEach(function (j) {
    if (j.data.proud) c.push({ t: j.data.proud, src: 'Proud of \u00b7 ' + niceDate(j.at) }); if (j.data.gave) c.push({ t: j.data.gave, src: 'You gave them \u00b7 ' + niceDate(j.at) }); });
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
  var d = NOW(), h = d.getHours() + d.getMinutes() / 60, n = doneCount(), cr = credits(), out = '';
  out += '<header class="hello"><p class="date">' + esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '</p><h1>' + greeting() + '.</h1></header>';
  if (n < P.length) {
    var nq = drafts[ui.lastQ] != null || !answered(ui.lastQ) ? ui.lastQ : nextOpen(ui.lastQ);
    out += '<button class="card reflect-card" data-do="resume"><p class="eyebrow">Reflect \u00b7 ' + n + ' of ' + P.length + '</p><p class="serif">' + esc(fill(P[nq].t)) + '</p><p class="small">' + (n ? 'Pick up where you left off' : 'Start whenever you\u2019re ready. One question is plenty.') + ' \u2192</p></button>';
  }
  if (h >= 17.5 && h < 20 && !isShabbat(d)) out += '<div class="card soft"><p class="eyebrow">Family time</p><p>You don\u2019t need a perfect evening. One small moment is enough.</p></div>';
  out += journalCard(d);
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
function vMomentOld() {
  return '<h1>Right now</h1><p class="lead">One breath first.</p>' +
    HELP.map(function (h) { return '<button class="card helper" data-do="help" data-arg="' + h[0] + '"><p class="serif">' + esc(fill(h[1])) + '</p><p class="small">' + esc(h[2]) + '</p></button>'; }).join('') +
    '<button class="btn ghost" data-do="ask">Ask Katya</button>';
}
on('help', function (k) { open(function () { return vHelp(k); }); });
function yours(q, label) { var t = latest(q).trim(); return t ? '<div class="yours"><p class="eyebrow">' + esc(label) + '</p><p>' + nl(t) + '</p></div>' : '<p class="small">Answer reflection ' + (q + 1) + ' and your own words will show up here. <a href="#" data-do="gotoQ" data-arg="' + q + '">Answer it</a></p>'; }
on('gotoQ', function (q) { openQ(+q); });
function back() { return '<div class="bar"><button class="link" data-do="closeO">\u2190 Back</button></div>'; }
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
  var o = '<h1>Small moments</h1>' +
    '<div class="card"><p class="eyebrow">Log a moment</p><div class="chips">' + kids().map(function (k) { return '<button class="chip' + (k === kd ? ' on' : '') + '" data-do="kid" data-arg="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' +
    '<textarea id="mtext" rows="3" placeholder="What happened? Even a minute counts."></textarea>' +
    '<div class="chips">' + TAGS.map(function (t) { return '<button class="chip tag' + (t === pre.tag ? ' on' : '') + '" data-do="tag" data-arg="' + t + '">' + t + '</button>'; }).join('') + '</div>' +
    '<button class="btn primary" data-do="saveMoment">Save moment</button></div>' +
    '<p class="count">' + (wk ? wk + ' small moment' + (wk > 1 ? 's' : '') + ' this week' : 'None logged this week yet. They still happened.') + '</p>' +
    '<div class="card"><p class="eyebrow">One-on-one ideas with ' + esc(child()) + '</p><ul class="ideas">' + oneOnOneIdeas().slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
    (items(12).length || items(11).length ? '<p class="small">From your own answers.</p>' : '<p class="small">Starter ideas. <a href="#" data-do="gotoQ" data-arg="12">Add your own</a></p>') + '</div>';
  o += lettersCard();
  o += ms.slice(0, 40).map(function (m) { return '<div class="moment"><p class="small">' + esc(niceDate(m.at)) + ' \u00b7 ' + esc(m.data.kid) + (m.data.tag ? ' \u00b7 ' + esc(m.data.tag) : '') + '</p><p>' + nl(m.data.text) + '</p></div>'; }).join('');
  return o;
}
on('kid', function (k) { var t = $app.querySelector('#mtext').value; ui.kid = k; jset('steady.ui', ui); route.preset = Object.assign({}, route.preset, { kid: k }); render(); $app.querySelector('#mtext').value = t; });
on('tag', function (t, b) { var on_ = b.classList.contains('on'); $app.querySelectorAll('.chip.tag').forEach(function (x) { x.classList.remove('on'); }); if (!on_) b.classList.add('on'); route.preset = Object.assign({}, route.preset, { tag: on_ ? '' : t }); });
on('saveMoment', function () { var t = $app.querySelector('#mtext').value.trim(); var tg = $app.querySelector('.chip.tag.on'); if (!t && !tg) { toast('Write a few words or pick a tag'); return; }
  entry('moment', { kid: (route.preset || {}).kid || ui.kid || child(), text: t, tag: tg ? tg.dataset.arg : '' }); route.preset = {}; toast('Saved. That mattered.'); render(); });

/* ---------- Care: self-compassion + self-care ---------- */
function vCareOld() {
  var ws = entries('win'), wk = ws.filter(function (w) { return daysAgo(w.at) < 7; }), harsh = latest(2).trim(), plan = entries('plan')[0], pi = plan ? plan.data.items : [];
  var seeds = items(5).concat(items(6)).filter(function (x) { return pi.indexOf(x) < 0; });
  var o = '<h1>Care</h1>';
  o += '<div class="card"><p class="eyebrow">Did well \u00b7 ' + winsToday().length + ' today \u00b7 ' + wk.length + ' this week</p><div class="chips">' + WINS.map(function (x) { return '<button class="chip" data-do="win" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
    '<div class="inline"><input id="winx" placeholder="Something else I did well"><button class="btn small" data-do="winx">Add</button></div></div>';
  o += '<div class="card credit"><p class="eyebrow">Remember this</p>' + (credits().length ? '<ul class="wall">' + credits().slice(0, 12).map(function (c) { return '<li><span>' + esc(c.t) + '</span><small>' + esc(c.src) + '</small></li>'; }).join('') + '</ul>' : '<p class="small">Your answers to reflections 1 and 2 will live here. <a href="#" data-do="gotoQ" data-arg="0">Start</a></p>') + '</div>';
  o += journalHistory();
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
function vReflectOld() {
  var n = doneCount(), o = '<h1>Reflect</h1><p class="lead">' + n + ' of ' + P.length + ' answered</p>';
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
function journalCardOld(d) {
  if (isShabbat(d)) return '<div class="card soft"><p class="eyebrow">Shabbat</p><p>Nothing to fill in. Just be with them.</p></div>';
  var h = d.getHours();
  if (h >= 5 && h < 12 && !jToday('am')) return '<button class="card journal-card" data-do="journal" data-arg="am"><p class="eyebrow">Morning \u00b7 about a minute</p><p class="serif">Who do you want to be with the kids today?</p><p class="small">One intention, one thing you\u2019re grateful for \u2192</p></button>';
  if ((h >= 20 || h < 3) && !jToday('pm')) return '<button class="card journal-card eve" data-do="journal" data-arg="pm"><p class="eyebrow">Evening \u00b7 two or three minutes</p><p class="serif">Before the day closes, notice what went right.</p><p class="small">Four short questions. Any of them can stay blank \u2192</p></button>';
  return '';
}
var jdraft = {};
on('journal', function (kind) { var ex = jToday(kind); jdraft = ex ? Object.assign({}, ex.data, { eid: ex.id }) : { kind: kind }; open(function () { return vJournal(kind); }); });
function kidChips(field, cur) { return '<div class="chips">' + kids().map(function (k) { return '<button class="chip' + (k === cur ? ' on' : '') + '" data-do="jkid" data-arg="' + field + '|' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>'; }
function jf(id, label, hint, rows) { return '<label class="lbl" for="j_' + id + '">' + label + '</label>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '<textarea id="j_' + id + '" rows="' + (rows || 2) + '">' + esc(jdraft[id] || '') + '</textarea>'; }
function vJournal(kind) {
  var o = back();
  if (kind === 'am') {
    var idea = jdraft.kid ? pick(jdraft.kid === child() ? oneOnOneIdeas() : ['A few minutes of their favorite thing, together', 'Ask about something they care about, then just listen', 'A silly moment at breakfast'], today() + jdraft.kid) : '';
    o += '<p class="eyebrow">Good morning</p><h1>Just a minute.</h1>' +
      jf('intention', 'Who do I want to be with the kids today?', 'One word or one line is enough. Calm, present, playful\u2026') +
      '<label class="lbl">One child to give a small moment to <span class="opt">optional</span></label>' + kidChips('kid', jdraft.kid) +
      (idea ? '<p class="hint">Maybe: \u201c' + esc(idea) + '\u201d</p>' : '') +
      jf('grateful', 'One thing I\u2019m grateful for', 'Big or tiny.') + aboutChips();
  } else {
    var gv = items(1), ci = careItems();
    o += '<p class="eyebrow">This evening</p><h1>What went right today.</h1><p class="small">There\u2019s no wrong answer, and you don\u2019t have to fill them all.</p>' +
      jf('proud', 'Something I\u2019m proud of as a dad today', '') +
      jf('moment', 'One small moment of connection', 'A look, a joke, a ride. Small counts.') + kidChips('momentKid', jdraft.momentKid) +
      jf('gave', 'Something I gave them that I\u2019d usually overlook', gv.length ? 'Like you wrote: \u201c' + esc(pick(gv, today() + 'g')) + '\u201d' : 'Patience, a hug, being home for dinner\u2026') +
      jf('care', 'Something I did to take care of myself', ci.length ? 'Even a little: \u201c' + esc(pick(ci, today() + 'j')) + '\u201d' : 'Even five minutes counts.') +
      jf('love', 'Something I love or admire about one of them <span class="opt">optional</span>', 'Goes into their letter.') + kidChips('loveKid', jdraft.loveKid || child()) + aboutChips();
  }
  return '<div class="page">' + o + '<button class="btn primary" data-do="saveJournal" data-arg="' + kind + '">Save</button></div>';
}
function readJ(kind) { ['intention', 'grateful', 'proud', 'moment', 'gave', 'care', 'love'].forEach(function (f) { var e = $app.querySelector('#j_' + f); if (e) jdraft[f] = e.value.trim(); }); }
function aboutChips() { var a = jdraft.about || []; return '<label class="lbl">This entry is about <span class="opt">optional \u00b7 shows in their portal</span></label><div class="chips">' + kids().concat(['Me']).map(function (k) { return '<button class="chip' + (a.indexOf(k) >= 0 ? ' on' : '') + '" data-do="jabout" data-arg="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>'; }
on('jabout', function (k) { var kind = jdraft.kind; readJ(); var a = (jdraft.about || []).slice(), i = a.indexOf(k); if (i >= 0) a.splice(i, 1); else a.push(k); jdraft.about = a; open(function () { return vJournal(kind); }); });
on('jkid', function (a) { var p = a.split('|'), kind = jdraft.kind; readJ(); jdraft[p[0]] = jdraft[p[0]] === p[1] && p[0] !== 'loveKid' ? '' : p[1]; open(function () { return vJournal(kind); }); });
on('saveJournal', function (kind) {
  readJ(); var all = ['intention', 'grateful', 'proud', 'moment', 'gave', 'care', 'love'].map(function (f) { return jdraft[f] || ''; }).join('\n');
  if (!all.trim()) { toast('Nothing to save yet'); return; }
  var m = all.match(HARSH);
  if (m && !jdraft.kindChecked) { open(function () { return vKinder(m[0], all); }); return; }
  commitJournal();
});
function kinderRewrite() { var r = entries('reframe')[0]; return r ? r.data.text : 'Today had a hard moment, and I care enough to notice it. That\u2019s what a loving father does. I can repair it, and it doesn\u2019t undo the love I give them every day.'; }
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
  toast(d.kind === 'am' ? 'Have a good day.' : 'Saved. Rest well.'); if (back_) { route = { tab: 'people' }; ui.portal = back_; jset('steady.ui', ui); open(function () { return vSec(back_, 'journal'); }); } else go('home');
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
  return '<div class="card letter-card"><p class="eyebrow">Letter to ' + esc(k) + '</p>' +
    (inPortal ? '<p class="small">Built from what you notice and the moments you keep. ' + ls.length + ' thing' + (ls.length === 1 ? '' : 's') + ' noted so far.</p>' :
    '<div class="chips">' + kids().map(function (x) { return '<button class="chip' + (x === k ? ' on' : '') + '" data-do="lkid" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
    '<p class="small">Things you love or admire about ' + esc(k) + '. One line at a time, whenever you notice.</p>' +
    '<div class="inline"><input id="lovex" placeholder="I love how\u2026"><button class="btn small" data-do="addLove">Add</button></div>' +
    (ls.length ? '<ul class="wall">' + ls.slice(0, 8).map(function (l) { return '<li><span>' + esc(l.data.text) + '</span><small>' + esc(niceDate(l.at)) + (l.data.src === 'journal' ? ' \u00b7 from your evening journal' : '') + '</small></li>'; }).join('') + '</ul>' + (ls.length > 8 ? '<p class="small">+ ' + (ls.length - 8) + ' more</p>' : '') : '')) +
    (q ? '' : '<button class="btn primary" data-do="compose">Compose letter</button>') +
    (lt.length ? '<p class="small">Saved letters: ' + lt.map(function (l) { return '<a href="#" data-do="openLetter" data-arg="' + l.id + '">' + esc(l.data.occasion || 'Letter') + ' \u00b7 ' + esc(niceDate(l.at)) + '</a>'; }).join(', ') + '</p>' : '') + '</div>';
}
on('lkid', function (k) { lkid = k; render(); });
on('addLove', function () { var v = $app.querySelector('#lovex').value.trim(); if (!v) return; entry('love', { kid: route.tab === 'people' ? portal() : lkid || child(), text: v }); toast('Kept for the letter'); render(); });
var OCC = { 'Birthday': ['Happy birthday. Another year of watching you grow, and I wanted to write down some of what I see.', 'I\u2019m so proud to be your father. I hope this year is full of good things.'],
  'A milestone': ['This is a big day, and before it passes I wanted to tell you some things I don\u2019t always say out loud.', 'Whatever comes next, I\u2019m right behind you.'],
  'A hard week': ['I know this week has been hard. You don\u2019t have to talk about it. I just wanted you to have this.', 'Hard weeks end. What I feel about you doesn\u2019t change. I\u2019m here whenever you want me.'],
  'Just because': ['No reason for this letter except that I love you and wanted you to know it in writing.', 'I\u2019m lucky to be your father.'] };
var letter = null;
on('compose', function () { var k = lkid || child(); letter = { kid: k, occasion: 'Just because' }; letter.text = buildLetter(k, letter.occasion); open(vLetter); });
on('openLetter', function (id) { var l = entries('letter').filter(function (x) { return x.id === id; })[0]; if (!l) return; letter = Object.assign({ eid: l.id }, l.data); open(vLetter); });
function buildLetter(k, occ) {
  var ls = loves(k).slice().reverse().map(function (l) { return l.data.text.replace(/\.$/, ''); });
  var ms = entries('moment').filter(function (m) { return m.data.kid === k && m.data.text; }).slice(0, 4).reverse().map(function (m) { return m.data.text.replace(/\.$/, ''); });
  var o = OCC[occ], t = 'Dear ' + k + ',\n\n' + o[0] + '\n\n';
  if (ls.length) t += 'Some things I love about you:\n' + ls.map(function (x) { return '\u2022 ' + x; }).join('\n') + '\n\n';
  if (ms.length) t += 'Some small moments with you that I keep with me:\n' + ms.map(function (x) { return '\u2022 ' + x; }).join('\n') + '\n\n';
  if (!ls.length && !ms.length) t += '[Write a few things you love about ' + k + ' here]\n\n';
  return t + o[1] + '\n\nI love you always,\nAbba';
}
function vLetter() {
  return '<div class="page"><div class="ptop"><button class="link" data-do="closeO">\u2190 Back</button></div><p class="eyebrow">Letter to ' + esc(letter.kid) + '</p><h1>Your words, gathered.</h1>' +
    '<p class="small">Everything you\u2019ve noted is in here. Edit it however you like and keep it for the right moment.</p>' +
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
function accent(k) { if (k === 'Me') return '#7E9A7F'; var i = kids().indexOf(k); return ACC[(i < 0 ? 0 : i) % ACC.length]; }
function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
function photoOf(k) { var m = memories(k).filter(function (x) { return x.data.thumb; })[0]; return m ? m.data.thumb : ''; }
function avatar(k, cls) { var ph = photoOf(k); return '<span class="av ' + (cls || '') + '" style="--a:' + accent(k) + (ph ? ';background-image:url(' + esc(ph) + ')' : '') + '">' + (ph ? '' : k === 'Me' ? '\u2661' : esc(k.charAt(0))) + '</span>'; }
function bubbles(cur) {
  return '<div class="bubbles">' + kids().concat(['Me']).map(function (k) {
    return '<button class="bubble' + (k === cur ? ' on' : '') + '" style="--a:' + accent(k) + '" data-do="portal" data-arg="' + esc(k) + '">' + avatar(k, 'sm') + '<span>' + esc(k) + '</span></button>'; }).join('') + '</div>';
}
on('portal', function (k) { ui.portal = k; jset('steady.ui', ui); route = { tab: 'people' }; overlay = null; render(); window.scrollTo(0, 0); });
function stage(a) { return a == null || isNaN(a) ? 'kid' : a < 5 ? 'little' : a < 10 ? 'kid' : 'teen'; }
var NEEDS = { little: ['Floor time, at their level', 'Slow, sing-song transitions', 'Being held when it\u2019s too much', 'Same bedtime words every night', 'Me noticing out loud what they\u2019re doing'],
  kid: ['Undivided attention for ten minutes', 'Me being curious, not correcting', 'Help naming big feelings', 'A predictable rhythm'],
  teen: ['Space without distance', 'Me available, not pushing', 'Being taken seriously', 'Side-by-side time with no agenda', 'Trust, a little more than feels comfortable', 'Repair when I get it wrong'] };
var NOTICE_PH = { little: 'The way they light up when\u2026', kid: 'I notice how\u2026', teen: 'I noticed how\u2026' };
function forKid(type, k) { return entries(type).filter(function (e) { return e.data.kid === k; }); }
function journalFor(k) { return entries('journal').filter(function (j) { var x = j.data; return (x.about || []).indexOf(k) >= 0 || (k !== 'Me' && (x.kid === k || x.momentKid === k || x.loveKid === k)) || (k === 'Me' && x.care); }); }
function jline(j) { var x = j.data, f = [['intention', 'Wanted to be'], ['grateful', 'Grateful for'], ['proud', 'Proud of'], ['moment', 'A moment'], ['gave', 'I gave them'], ['care', 'For myself'], ['love', 'I love'], ['kinder', 'Kinder version']];
  return '<div class="entry"><p class="when">' + esc(niceDate(j.at)) + ' \u00b7 ' + (x.kind === 'am' ? 'Morning' : 'Evening') + '</p>' + f.filter(function (y) { return x[y[0]]; }).map(function (y) { return '<p><b>' + y[1] + '</b> ' + esc(x[y[0]]) + '</p>'; }).join('') + '</div>'; }
var SECS = {
  notice: ['\u2727', 'Notice'], needs: ['\u25C7', 'Needs'], mem: ['\u25A3', 'Memories'], moments: ['\u2766', 'Moments'], journal: ['\u270E', 'Journal'], letter: ['\u2709', 'Letter'],
  kind: ['\u2661', 'Kindness'], talk: ['\u275D', 'Self-talk'], wins: ['\u2714', 'Wins'] };
function tile(k, s, count, preview, extra) { return '<button class="tile" data-do="sec" data-arg="' + s + '"><i>' + SECS[s][0] + '</i><b>' + SECS[s][1] + (count ? '<em>' + count + '</em>' : '') + '</b>' + (extra || '') + '<small>' + esc(cut(preview, 48)) + '</small></button>'; }
function strip(k) { var t = memories(k).filter(function (m) { return m.data.thumb; }).slice(0, 4); return t.length ? '<span class="strip">' + t.map(function (m) { return '<span style="background-image:url(' + esc(m.data.thumb) + ')"></span>'; }).join('') + '</span>' : ''; }
function vPortal() {
  var k = portal(), a = ages()[k], me = k === 'Me', q = isShabbat(NOW()), o = bubbles(k);
  o += '<header class="phead" style="--a:' + accent(k) + '">' + avatar(k, 'lg') + '<div><h1>' + (me ? 'You' : esc(k)) + '</h1><p>' + (me ? 'Looking after the one who looks after them' : a ? esc(String(a)) + (a === 1 ? ' year' : ' years') : '') + '</p></div></header>';
  if (q) o += '<p class="quiet">Shabbat \u00b7 just for reading</p>';
  var ms = memories(k), lm = ms[0];
  if (!me) {
    var ls = loves(k), nd = forKid('need', k), mo = forKid('moment', k), js = journalFor(k), lt = entries('letter').filter(function (l) { return l.data.kid === k; });
    o += '<div class="tiles" style="--a:' + accent(k) + '">' +
      tile(k, 'mem', ms.length, lm ? lm.data.note || niceDate(lm.data.date) : 'Add the first one', strip(k)) +
      tile(k, 'notice', ls.length, ls[0] ? ls[0].data.text : 'What you see in them') +
      tile(k, 'moments', mo.length, mo[0] ? (mo[0].data.tag || mo[0].data.text) : 'Small counts') +
      tile(k, 'needs', nd.length, nd[0] ? nd[0].data.text : 'In this season') +
      tile(k, 'journal', js.length, js[0] ? niceDate(js[0].at) : 'Tag an entry') +
      tile(k, 'letter', lt.length, lt[0] ? (lt[0].data.occasion || 'Letter') : 'Words for them') + '</div>';
  } else {
    var sc = entries('selfcheck')[0], rf = entries('reframe'), ws = entries('win'), mn = forKid('need', 'Me'), mj = journalFor('Me');
    o += '<div class="tiles" style="--a:' + accent(k) + '">' +
      tile(k, 'kind', 0, sc && day(sc.at) === today() ? ({ gentle: 'Gently, today', okay: 'Getting by', hard: 'Hard on myself today' })[sc.data.tone] : pick(SELF, today() + 's')) +
      tile(k, 'talk', rf.length, rf[0] ? rf[0].data.text : 'Answer the harsh voice') +
      tile(k, 'wins', ws.length, ws[0] ? ws[0].data.label : 'It counts') +
      tile(k, 'needs', mn.length, mn[0] ? mn[0].data.text : 'Name one') +
      tile(k, 'mem', ms.length, lm ? lm.data.note || niceDate(lm.data.date) : 'Proud of myself', strip(k)) +
      tile(k, 'journal', mj.length, mj[0] ? niceDate(mj[0].at) : 'Your entries') + '</div>';
  }
  return o;
}
on('sec', function (s) { var k = portal(); open(function () { return vSec(k, s); }); });
function vSec(k, s) {
  var q = isShabbat(NOW()), me = k === 'Me', a = ages()[k], o = '', title = SECS[s][1];
  if (s === 'notice') { var ls = loves(k); title = 'What I notice';
    if (!q) o += '<div class="inline"><input id="lovex" placeholder="' + esc(NOTICE_PH[stage(a)]) + '"><button class="btn small" data-do="addLove">Add</button></div>';
    o += ls.length ? '<ul class="wall">' + ls.map(function (l) { return '<li><span>' + esc(l.data.text) + '</span><small>' + esc(niceDate(l.at)) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">Nothing yet.</p>'; }
  if (s === 'needs') { var nd = forKid('need', k), sd = me ? items(6).concat(items(5)) : NEEDS[stage(a)]; title = me ? 'What I need' : 'What ' + k + ' needs';
    o += nd.length ? '<ul class="plan">' + nd.map(function (n) { return '<li><span>' + esc(n.data.text) + '</span>' + (q ? '' : '<button class="x" data-do="rmNeed" data-arg="' + n.id + '" aria-label="Remove">\u00d7</button>') + '</li>'; }).join('') + '</ul>' : '';
    if (!q) o += '<div class="chips">' + sd.filter(function (x) { return !nd.some(function (n) { return n.data.text === x; }); }).slice(0, 5).map(function (x) { return '<button class="chip" data-do="addNeed" data-arg="' + esc(x) + '">+ ' + esc(x) + '</button>'; }).join('') + '</div><div class="inline"><input id="needx" placeholder="In my own words"><button class="btn small" data-do="needx">Add</button></div>'; }
  if (s === 'mem') o += memoriesCard(k, q);
  if (s === 'moments') { var mo = forKid('moment', k); title = 'Moments together';
    if (!q) o += '<textarea id="mtext" rows="2" placeholder="What happened?"></textarea><div class="chips">' + TAGS.map(function (t) { return '<button class="chip tag" data-do="tag" data-arg="' + t + '">' + t + '</button>'; }).join('') + '</div><button class="btn primary" data-do="saveMomentK">Save moment</button>';
    o += mo.length ? '<div class="list">' + mo.map(function (m) { return '<div class="moment"><p class="when">' + esc(niceDate(m.at)) + (m.data.tag ? ' \u00b7 ' + esc(m.data.tag) : '') + '</p>' + (m.data.text ? '<p>' + nl(m.data.text) + '</p>' : '') + '</div>'; }).join('') + '</div>' : ''; }
  if (s === 'journal') { var js = journalFor(k);
    if (!q) o += '<div class="row2"><button class="btn" data-do="jfor" data-arg="am">\u2600 Morning</button><button class="btn" data-do="jfor" data-arg="pm">\u263E Evening</button></div>';
    o += js.length ? '<div class="list">' + js.map(jline).join('') + '</div>' : '<p class="empty">Tag an entry with ' + esc(me ? 'Me' : k) + ' and it lands here.</p>'; }
  if (s === 'letter') { lkid = k; title = 'Letter to ' + k; o += lettersCard(true); }
  if (s === 'kind') { var sc = entries('selfcheck'), last = sc[0]; title = 'Kindness';
    o += '<p class="big-quote">' + esc(pick(SELF, today() + 's')) + '</p>';
    if (!q) o += '<p class="q">How am I treating myself today?</p><div class="chips">' + TONES.map(function (t) { return '<button class="chip' + (last && day(last.at) === today() && last.data.tone === t[0] ? ' on' : '') + '" data-do="tone" data-arg="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (last && day(last.at) === today() && last.data.tone === 'hard') o += '<div class="script"><p class="serif">What would you say to a friend who felt this way tonight?</p></div>';
    if (sc.length) o += '<p class="when">Lately ' + sc.slice(0, 7).map(function (x) { return ({ gentle: '\u2661', okay: '\u00b7', hard: '\u25CB' })[x.data.tone]; }).join(' ') + '</p>'; }
  if (s === 'talk') { var harsh = latest(2).trim(), rf = entries('reframe');
    if (harsh) o += '<p class="quote">' + nl(harsh) + '</p>';
    if (!q) o += '<textarea id="talk" rows="3" placeholder="What am I telling myself?"></textarea><button class="btn primary" data-do="checkTalk">Look at it kindly</button>';
    o += '<p class="q">Kinder versions</p>' + (rf.length ? '<ul class="wall">' + rf.slice(0, 8).map(function (r) { return '<li><span>' + esc(r.data.text) + '</span><small>' + esc(niceDate(r.at)) + '</small></li>'; }).join('') + '</ul>' : '<p class="serif">' + esc(reframe()) + '</p>'); }
  if (s === 'wins') { var ws = entries('win'), wk = ws.filter(function (w) { return daysAgo(w.at) < 7; }).length;
    o += '<p class="stat"><b>' + winsToday().length + '</b> today <b>' + wk + '</b> this week</p>';
    if (!q) o += '<div class="chips">' + WINS.map(function (x) { return '<button class="chip" data-do="win" data-arg="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div><div class="inline"><input id="winx" placeholder="Something else"><button class="btn small" data-do="winx">Add</button></div>';
    o += ws.length ? '<ul class="wall">' + ws.slice(0, 12).map(function (w) { return '<li><span>' + esc(w.data.label) + '</span><small>' + esc(niceDate(w.at)) + '</small></li>'; }).join('') + '</ul>' : ''; }
  return '<div class="page sec-page" style="--a:' + accent(k) + '"><div class="bar"><button class="link" data-do="closeO">\u2190 ' + esc(me ? 'Me' : k) + '</button></div>' +
    '<header class="shead">' + avatar(k, 'sm') + '<h1>' + esc(title) + '</h1></header>' + (q ? '<p class="quiet">Shabbat \u00b7 just for reading</p>' : '') + o + '</div>';
}
on('addNeed', function (t) { entry('need', { kid: portal(), text: t }); render(); });
on('needx', function () { var v = $app.querySelector('#needx').value.trim(); if (v) { entry('need', { kid: portal(), text: v }); toast('Kept.'); render(); } });
on('rmNeed', function (id) { delEntry(id); render(); });
on('saveMomentK', function () { var t = $app.querySelector('#mtext').value.trim(), tg = $app.querySelector('.chip.tag.on'); if (!t && !tg) { toast('A few words or a tag'); return; } entry('moment', { kid: portal(), text: t, tag: tg ? tg.dataset.arg : '' }); toast('Saved. That mattered.'); render(); });
on('jfor', function (kind) { var k = portal(), ex = jToday(kind); jdraft = ex ? Object.assign({}, ex.data, { eid: ex.id }) : { kind: kind }; var a = (jdraft.about || []).slice(); if (a.indexOf(k) < 0) a.push(k); jdraft.about = a; jdraft.backTo = k; open(function () { return vJournal(kind); }); });
var SELF = ['You are allowed to be a work in progress and a good father at the same time.', 'Tired is not the same as failing.', 'You would never hold a friend to the standard you hold yourself to.', 'Coming back after a hard moment is the skill. You keep doing it.', 'Rest is not something you have to earn.'];
var TONES = [['gentle', 'Gently'], ['okay', 'Getting by'], ['hard', 'Hard on myself']];
on('tone', function (t) { var l = entries('selfcheck')[0]; entry('selfcheck', { tone: t }, l && day(l.at) === today() ? l.id : uid()); toast(t === 'hard' ? 'Noticed. Go easy tonight.' : 'Noted.'); render(); });
on('checkTalk', function () { var t = $app.querySelector('#talk').value.trim(); if (!t) return; var m = t.match(HARSH);
  if (!m) { entry('reframe', { text: t }); toast('Kept. That sounds kind.'); render(); return; }
  open(function () { return '<div class="page"><div class="bar"><button class="link" data-do="secBack" data-arg="talk">\u2190 Self-talk</button></div><h1>You wrote \u201c' + esc(m[0]) + '.\u201d</h1><p class="quote">' + nl(t) + '</p><p class="q">Would you say that to someone you love?</p>' +
    '<div class="script"><p class="serif">' + esc(kinderRewrite()) + '</p></div><textarea id="kind" rows="4" placeholder="Or in your own words"></textarea><button class="btn primary" data-do="keepTalk">Keep the kinder version</button></div>'; }); });
on('keepTalk', function () { var t = $app.querySelector('#kind').value.trim(); entry('reframe', { text: t || kinderRewrite() }); toast('Kept.'); var k = portal(); open(function () { return vSec(k, 'talk'); }); });
on('secBack', function (s) { var k = portal(); open(function () { return vSec(k, s); }); });

/* ---------- home ---------- */
function vHome() {
  var d = NOW(), q = isShabbat(d), o = '<header class="home-hello"><p class="date">' + esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '</p><h1>' + greeting() + '.</h1></header>';
  o += journalCard(d) || (q ? '' : '<button class="card prompt-card" data-do="journal" data-arg="' + (d.getHours() < 15 ? 'am' : 'pm') + '"><p class="eyebrow">' + (d.getHours() < 15 ? '\u2600 Morning' : '\u263E Evening') + '</p><p class="serif">' + (jToday('am') || jToday('pm') ? 'Add to today\u2019s journal' : 'A minute for your journal') + '</p></button>');
  o += '<div class="people">' + kids().map(function (k) {
    var m = memories(k)[0], mo = forKid('moment', k)[0], a = ages()[k], line = m ? (m.data.note || 'A memory') : mo ? (mo.data.text || mo.data.tag) : loves(k)[0] ? loves(k)[0].data.text : '';
    return '<button class="person" style="--a:' + accent(k) + '" data-do="portal" data-arg="' + esc(k) + '">' + avatar(k, 'lg') + '<span class="pt"><b>' + esc(k) + (a ? '<em>' + a + '</em>' : '') + '</b>' + (line ? '<small>' + esc(cut(line, 60)) + '</small>' : '') + '</span><span class="chev">\u203A</span></button>'; }).join('') +
    '<button class="person me" style="--a:' + accent('Me') + '" data-do="portal" data-arg="Me">' + avatar('Me', 'lg') + '<span class="pt"><b>Me</b><small>' + esc(cut(pick(SELF, today() + 's'), 60)) + '</small></span><span class="chev">\u203A</span></button></div>';
  var otd = onThisDay(); if (otd) o += '<div class="otd"><p class="eyebrow">' + otd.label + '</p>' + card(otd.it, true) + '</div>';
  var allm = entries('memory').filter(function (m) { return m.data.thumb; }), ai = allItems(), wkn = ai.filter(function (i) { return daysAgo(i.day) < 7; });
  o += '<div class="grid">' +
    '<button class="gtile wide arch" data-tab="archive"><b>\u270E Journal</b><small>' + (ai.length ? ai.length + ' entries \u00b7 ' + wkn.length + ' this week' : 'Everything you write, by day') + '</small>' + (wkn.length ? dots(uniqWho(wkn)) : '') + '</button>' +
    '<button class="gtile wide" data-tab="memories"><b>\u25A3 Memories</b>' + (allm.length ? '<span class="strip">' + allm.slice(0, 5).map(function (m) { return '<span style="background-image:url(' + esc(m.data.thumb) + ')"></span>'; }).join('') + '</span>' : '<small>Photos and proud moments</small>') + '</button>' +
    '<button class="gtile" data-tab="letters"><b>\u2709 Letters</b><small>' + entries('letter').length + ' kept</small></button>' +
    '<button class="gtile" data-tab="moment"><b>\u2766 Right now</b><small>A hard moment</small></button>' +
    '<button class="gtile" data-tab="reflect"><b>\u270E Reflect</b><small>' + doneCount() + ' of ' + P.length + '</small></button>' +
    '<button class="gtile" data-tab="care"><b>\u2600 Care</b><small>Plan and journal</small></button></div>';
  var th = (V.config.therapy || '').toLowerCase(), wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  if (th && th.indexOf(wd) === 0) o += '<div class="card soft"><p>' + esc(child()) + '\u2019s session is tonight. Be nearby and easy.</p></div>';
  var cr = credits(); if (cr.length) { var c = pick(cr, today() + 'c'); o += '<div class="card credit"><p class="eyebrow">Remember</p><p class="serif">' + esc(c.t) + '</p></div>'; }
  if (!standalone() && !ui.noInstall) o += '<div class="card soft"><p class="small">' + (/iphone|ipad/i.test(navigator.userAgent) ? 'Safari \u2192 Share \u2192 Add to Home Screen' : 'Menu \u2192 Add to Home screen') + '</p><div class="row2">' + (deferred ? '<button class="btn small" data-do="install">Install</button>' : '') + '<button class="btn small ghost" data-do="noInstall">Not now</button></div></div>';
  o += '<button class="btn ghost" data-do="ask">Ask Katya</button>';
  return o;
}
function vMemories() {
  var f = ui.memf || 'all', ks = kids().concat(['Me']);
  return '<h1>Memories</h1><div class="chips">' + ['all'].concat(ks).map(function (k) { return '<button class="chip' + (k === f ? ' on' : '') + '" data-do="memf" data-arg="' + esc(k) + '">' + (k === 'all' ? 'Everyone' : esc(k)) + '</button>'; }).join('') + '</div>' +
    (f === 'all' ? memoriesCard(null, isShabbat(NOW())) : memoriesCard(f, isShabbat(NOW())));
}
on('memf', function (k) { ui.memf = k; jset('steady.ui', ui); render(); });
function vLetters() {
  return '<h1>Letters</h1><div class="people">' + kids().map(function (k) { var lt = entries('letter').filter(function (l) { return l.data.kid === k; });
    return '<button class="person" style="--a:' + accent(k) + '" data-do="letterFor" data-arg="' + esc(k) + '">' + avatar(k, 'lg') + '<span class="pt"><b>' + esc(k) + '</b><small>' + (lt.length ? lt.length + ' kept \u00b7 ' + esc(niceDate(lt[0].at)) : loves(k).length + ' things noted') + '</small></span><span class="chev">\u203A</span></button>'; }).join('') + '</div>';
}
on('letterFor', function (k) { ui.portal = k; jset('steady.ui', ui); open(function () { return vSec(k, 'letter'); }); });

/* ---------- archive: every entry, one shape ---------- */
var TYPES = [['journal', 'Journal', '\u270E'], ['moment', 'Moments', '\u2766'], ['memory', 'Memories', '\u25A3'], ['notice', 'Notices', '\u2727'], ['win', 'Wins', '\u2714'], ['letter', 'Letters', '\u2709']];
function tinfo(t) { return TYPES.filter(function (x) { return x[0] === t; })[0] || ['', '', '\u00b7']; }
function allItems() {
  var out = [], ks = kids();
  function add(e, type, who, title, text, extra) { who = (who || []).filter(function (w) { return w === 'Me' || ks.indexOf(w) >= 0; }); if (!who.length) who = ['Me'];
    out.push(Object.assign({ id: e.id, at: e.at, day: (e.data.date || day(e.at)).slice(0, 10), type: type, who: who, title: title, text: String(text || '') }, extra || {})); }
  V.entries.forEach(function (e) { var d = e.data || {};
    if (e.type === 'journal') { var w = (d.about || []).slice(); [d.kid, d.momentKid, d.loveKid].forEach(function (k) { if (k && w.indexOf(k) < 0) w.push(k); }); if (d.care && w.indexOf('Me') < 0) w.push('Me');
      var f = [['intention', 'Wanted to be'], ['grateful', 'Grateful for'], ['proud', 'Proud of'], ['moment', 'A moment'], ['gave', 'I gave them'], ['care', 'For myself'], ['love', 'I love'], ['kinder', 'Kinder version']].filter(function (y) { return d[y[0]]; });
      add(e, 'journal', w, d.kind === 'am' ? 'Morning' : 'Evening', f.map(function (y) { return y[1] + ': ' + d[y[0]]; }).join('\n'), { fields: f.map(function (y) { return [y[1], d[y[0]]]; }) }); }
    else if (e.type === 'moment' && !/^jm_/.test(e.id)) add(e, 'moment', [d.kid], d.tag || 'Moment', d.text);
    else if (e.type === 'love' && !/^jl_/.test(e.id)) add(e, 'notice', [d.kid], 'Noticed', d.text);
    else if (e.type === 'win') add(e, 'win', ['Me'], 'Did well', d.label);
    else if (e.type === 'reframe') add(e, 'journal', ['Me'], 'Kinder version', d.text);
    else if (e.type === 'memory') add(e, 'memory', [d.kid], (PROUD.filter(function (p) { return p[0] === d.proud; })[0] || ['', 'Memory'])[1], d.note, { thumb: d.thumb, video: /^video/.test(d.mime || '') });
    else if (e.type === 'letter') add(e, 'letter', [d.kid], 'Letter \u00b7 ' + (d.occasion || ''), d.text);
  });
  return out.sort(function (a, b) { var x = a.day + a.at, y = b.day + b.at; return x < y ? 1 : -1; });
}
function af() { var f = ui.af || {}; return { who: f.who || [], types: f.types || [], q: f.q || '' }; }
function filtered(f) { f = f || af(); var q = f.q.toLowerCase().trim();
  return allItems().filter(function (it) { return (!f.who.length || it.who.some(function (w) { return f.who.indexOf(w) >= 0; })) && (!f.types.length || f.types.indexOf(it.type) >= 0) && (!q || (it.title + ' ' + it.text + ' ' + it.who.join(' ')).toLowerCase().indexOf(q) >= 0); }); }
function dots(who) { return '<span class="pdots">' + who.map(function (w) { return '<i style="background:' + accent(w) + '"></i>'; }).join('') + '</span>'; }
function card(it, showDate) { var t = tinfo(it.type), long = it.text.length > 90 || (it.fields && it.fields.length > 1);
  var head = '<span class="ci" style="--a:' + accent(it.who[0]) + '">' + t[2] + '</span><span class="cb"><span class="ct"><b>' + esc(it.title) + '</b><em>' + esc(it.who.join(', ')) + (showDate ? ' \u00b7 ' + esc(niceDate(it.day)) : ' \u00b7 ' + esc(String(it.at).slice(11, 16))) + '</em></span>' +
    '<span class="cx">' + esc(cut(it.text.replace(/\n+/g, ' \u00b7 '), 90)) + '</span></span>' + (it.thumb ? '<span class="th sm" style="background-image:url(' + esc(it.thumb) + ')">' + (it.video ? '<b>\u25B6</b>' : '') + '</span>' : '');
  if (it.type === 'memory') return '<button class="ent" data-do="openMem" data-arg="' + it.id + '">' + head + '</button>';
  if (!long) return '<div class="ent">' + head + '</div>';
  return '<details class="ent"><summary>' + head + '</summary><div class="full">' + (it.fields ? it.fields.map(function (f) { return '<p><b>' + esc(f[0]) + '</b>' + nl(f[1]) + '</p>'; }).join('') : '<p>' + nl(it.text) + '</p>') + '</div></details>';
}
function filterBar() { var f = af();
  return '<input id="asearch" type="search" placeholder="Search everything" value="' + esc(f.q) + '">' +
    '<div class="chips scroll">' + kids().concat(['Me']).map(function (k) { return '<button class="chip pc' + (f.who.indexOf(k) >= 0 ? ' on' : '') + '" style="--a:' + accent(k) + '" data-do="afWho" data-arg="' + esc(k) + '"><i style="background:' + accent(k) + '"></i>' + esc(k) + '</button>'; }).join('') + '</div>' +
    '<div class="chips scroll">' + TYPES.map(function (t) { return '<button class="chip' + (f.types.indexOf(t[0]) >= 0 ? ' on' : '') + '" data-do="afType" data-arg="' + t[0] + '">' + t[2] + ' ' + t[1] + '</button>'; }).join('') + '</div>';
}
function toggleIn(key, v) { var f = af(), a = f[key].slice(), i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); f[key] = a; ui.af = f; jset('steady.ui', ui); render(); }
on('afWho', function (k) { toggleIn('who', k); });
on('afType', function (t) { toggleIn('types', t); });
on('aview', function (v) { ui.aview = v; jset('steady.ui', ui); render(); });
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function weekStart(s) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); return ymd(d); }
function vArchive() {
  var v = ui.aview || 'feed', its = filtered(), o = '<h1>Journal</h1>';
  o += '<div class="seg"><button class="' + (v === 'feed' ? 'on' : '') + '" data-do="aview" data-arg="feed">Timeline</button><button class="' + (v === 'cal' ? 'on' : '') + '" data-do="aview" data-arg="cal">Calendar</button></div>';
  o += filterBar() + '<div id="ares">' + (v === 'cal' ? calendar(its) : feed(its)) + '</div>';
  return o;
}
function feed(its) {
  if (!its.length) return '<p class="empty">' + (af().q || af().who.length || af().types.length ? 'Nothing matches.' : 'Nothing written yet.') + '</p>';
  var o = '', mo = '', wk = '', dy = '', thisMonth = today().slice(0, 7), thisWeek = weekStart(today()), searching = !!af().q;
  its.slice(0, 400).forEach(function (it) { var m = it.day.slice(0, 7), w = weekStart(it.day);
    if (m !== mo) { if (mo) o += '</div></details></details>'; mo = m; wk = ''; var n = its.filter(function (x) { return x.day.slice(0, 7) === m; }).length;
      o += '<details class="month"' + (m === thisMonth || searching || o === '' ? ' open' : '') + '><summary><span>' + esc(new Date(m + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</span><em>' + n + '</em></summary>'; }
    if (w !== wk) { if (wk) o += '</div></details>'; wk = w; dy = ''; var e = new Date(w + 'T12:00:00'); e.setDate(e.getDate() + 6); var nw = its.filter(function (x) { return weekStart(x.day) === w; }).length;
      o += '<details class="week"' + (w === thisWeek || searching || true ? ' open' : '') + '><summary>Week of ' + esc(new Date(w + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '<em>' + nw + '</em></summary><div>'; }
    if (it.day !== dy) { dy = it.day; o += '<button class="dayh" data-do="openDay" data-arg="' + dy + '"><b>' + esc(new Date(dy + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })) + '</b>' + dots(uniqWho(its.filter(function (x) { return x.day === dy; }))) + '<span>\u203A</span></button>'; }
    o += card(it);
  });
  return o + '</div></details></details>';
}
function uniqWho(its) { var s = []; its.forEach(function (i) { i.who.forEach(function (w) { if (s.indexOf(w) < 0) s.push(w); }); }); var order = kids().concat(['Me']); return s.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); }); }
function calendar(its) {
  var m = ui.amonth || today().slice(0, 7), first = new Date(m + '-01T12:00:00'), y = first.getFullYear(), mi = first.getMonth(), nd = new Date(y, mi + 1, 0).getDate(), by = {};
  its.forEach(function (i) { (by[i.day] = by[i.day] || []).push(i); });
  var o = '<div class="calhead"><button class="link" data-do="amonth" data-arg="-1">\u2039</button><b>' + esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</b><button class="link" data-do="amonth" data-arg="1">\u203A</button></div><div class="cal">' +
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d, i) { return '<span class="dow' + (i === 6 ? ' sh' : '') + '">' + d + '</span>'; }).join('');
  for (var i = 0; i < first.getDay(); i++) o += '<span></span>';
  for (var dd = 1; dd <= nd; dd++) { var s = m + '-' + pad(dd), x = by[s] || [];
    o += '<button class="cd' + (s === today() ? ' today' : '') + (x.length ? ' has' : '') + '" data-do="openDay" data-arg="' + s + '"' + (x.length ? '' : ' disabled') + '><span>' + dd + '</span>' + (x.length ? dots(uniqWho(x)) : '') + '</button>'; }
  o += '</div>';
  var mc = its.filter(function (i) { return i.day.slice(0, 7) === m; });
  o += '<p class="when center">' + mc.length + ' entr' + (mc.length === 1 ? 'y' : 'ies') + ' this month \u00b7 ' + Object.keys(by).filter(function (k) { return k.slice(0, 7) === m; }).length + ' days</p>';
  return o;
}
on('amonth', function (dlt) { var m = ui.amonth || today().slice(0, 7), d = new Date(m + '-15T12:00:00'); d.setMonth(d.getMonth() + (+dlt)); ui.amonth = ymd(d).slice(0, 7); jset('steady.ui', ui); render(); });
on('openDay', function (s) { open(function () { return vDay(s); }); });
function vDay(s) {
  var its = filtered({ who: [], types: [], q: '' }).filter(function (i) { return i.day === s; }), d = new Date(s + 'T12:00:00');
  var prev = new Date(d), next = new Date(d); prev.setDate(d.getDate() - 1); next.setDate(d.getDate() + 1);
  var o = '<div class="page"><div class="bar"><button class="link" data-do="closeO">\u2190 Journal</button></div>' +
    '<div class="dayhead"><button class="link" data-do="openDay" data-arg="' + ymd(prev) + '" aria-label="Previous day">\u2039</button><div><p class="date">' + esc(d.toLocaleDateString(undefined, { weekday: 'long' })) + '</p><h1>' + esc(d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })) + '</h1></div><button class="link" data-do="openDay" data-arg="' + ymd(next) + '"' + (ymd(next) > today() ? ' disabled' : '') + ' aria-label="Next day">\u203A</button></div>';
  if (!its.length) return o + '<p class="empty">Nothing written this day. It still counted.</p></div>';
  uniqWho(its).forEach(function (w) { var mine = its.filter(function (i) { return i.who[0] === w || (i.who.indexOf(w) >= 0 && uniqWho([i])[0] === w); });
    if (!mine.length) return; var mem = mine.filter(function (i) { return i.thumb; });
    o += '<section class="dgroup" style="--a:' + accent(w) + '"><header>' + avatar(w, 'sm') + '<b>' + esc(w) + '</b><em>' + mine.length + '</em></header>' +
      (mem.length ? '<div class="mgrid">' + mem.map(function (i) { return '<button class="th" data-do="openMem" data-arg="' + i.id + '" style="background-image:url(' + esc(i.thumb) + ')">' + (i.video ? '<b>\u25B6</b>' : '') + '</button>'; }).join('') + '</div>' : '') +
      mine.filter(function (i) { return !i.thumb; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).map(function (i) { return card(i); }).join('') + '</section>'; });
  return o + '</div>';
}
function onThisDay() {
  var its = allItems(), t = today(), wk = new Date(t + 'T12:00:00'); wk.setDate(wk.getDate() - 7); var w = ymd(wk);
  var past = its.filter(function (i) { return i.day !== t && i.day.slice(5) === t.slice(5); });
  if (past.length) return { label: 'On this day', it: pick(past, t + 'o') };
  var lw = its.filter(function (i) { return i.day === w && (i.type === 'memory' || i.type === 'moment' || i.type === 'notice'); });
  if (lw.length) return { label: 'A week ago', it: pick(lw, t + 'w') };
  return null;
}
/* search box updates results without stealing focus */
$app.addEventListener('input', function (ev) { if (ev.target.id !== 'asearch') return; var f = af(); f.q = ev.target.value; ui.af = f; jset('steady.ui', ui); var r = document.getElementById('ares'); if (r) { r.innerHTML = (ui.aview === 'cal' ? calendar : feed)(filtered()); bindAll(); } });

/* ---------- clean versions of the older screens ---------- */
function vMoment() {
  var ic = { quiet: '\u263E', limit: '\u25A2', messed: '\u2661', racing: '\u2248' };
  return '<h1>Right now</h1><p class="lead">One breath first.</p><div class="stack">' +
    HELP.map(function (h) { return '<button class="rn" data-do="help" data-arg="' + h[0] + '"><i>' + ic[h[0]] + '</i><span><b>' + esc(fill(h[1])) + '</b><small>' + esc(h[2]) + '</small></span><span class="chev">\u203A</span></button>'; }).join('') + '</div>' +
    '<button class="btn ghost" data-do="ask">Ask Katya</button>';
}
function vCare() {
  var plan = entries('plan')[0], pi = plan ? plan.data.items : [], cr = credits();
  return '<h1>Care</h1><div class="tiles" style="--a:#7E9A7F">' +
    '<button class="tile" data-do="care" data-arg="plan"><i>\u2600</i><b>Self-care plan' + (pi.length ? '<em>' + pi.length + '</em>' : '') + '</b><small>' + esc(pi[0] || 'A few small, real things') + '</small></button>' +
    '<button class="tile" data-do="care" data-arg="remember"><i>\u2727</i><b>Remember' + (cr.length ? '<em>' + cr.length + '</em>' : '') + '</b><small>' + esc(cut(cr[0] ? cr[0].t : 'What you give them', 48)) + '</small></button>' +
    '<button class="tile" data-do="care" data-arg="kinder"><i>\u275D</i><b>Kinder voice</b><small>' + esc(cut(reframe(), 48)) + '</small></button>' +
    '<button class="tile" data-tab="archive"><i>\u270E</i><b>Journal</b><small>' + entries('journal').length + ' entries</small></button>' +
    '<button class="tile" data-do="portal" data-arg="Me"><i>\u2661</i><b>Me</b><small>Wins, needs, self-talk</small></button></div>';
}
on('care', function (s) { open(function () { return vCareSec(s); }); });
function vCareSec(s) {
  var o = '<div class="page sec-page" style="--a:#7E9A7F"><div class="bar"><button class="link" data-do="closeO">\u2190 Care</button></div>';
  if (s === 'plan') { var plan = entries('plan')[0], pi = plan ? plan.data.items : [], seeds = items(5).concat(items(6)).filter(function (x) { return pi.indexOf(x) < 0; });
    o += '<h1>Self-care plan</h1>' + (pi.length ? '<ul class="plan">' + pi.map(function (x, i) { return '<li><span>' + esc(x) + '</span><button class="x" data-do="rmPlan" data-arg="' + i + '" aria-label="Remove">\u00d7</button></li>'; }).join('') + '</ul>' : '') +
      (seeds.length ? '<div class="chips">' + seeds.slice(0, 6).map(function (x) { return '<button class="chip" data-do="addPlan" data-arg="' + esc(x) + '">+ ' + esc(x) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="inline"><input id="planx" placeholder="Add something"><button class="btn small" data-do="planx">Add</button></div>'; }
  if (s === 'remember') { var cr = credits(); o += '<h1>Remember</h1>' + (cr.length ? '<ul class="wall">' + cr.slice(0, 30).map(function (c) { return '<li><span>' + esc(c.t) + '</span><small>' + esc(c.src) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">Answer reflections 1 and 2 to start this. <a href="#" data-do="gotoQ" data-arg="0">Start</a></p>'); }
  if (s === 'kinder') { var harsh = latest(2).trim(); o += '<h1>Kinder voice</h1>' + (harsh ? '<p class="quote">' + nl(harsh) + '</p>' : '') + '<div class="script"><p class="serif">' + esc(reframe()) + '</p></div>' +
    '<textarea id="ref" rows="3" placeholder="In your own words"></textarea><button class="btn primary" data-do="saveRef">Keep this version</button>'; }
  return o + '</div>';
}
function vReflect() {
  var n = doneCount(), o = '<h1>Reflect</h1><div class="prog"><span style="width:' + Math.round(100 * n / P.length) + '%"></span></div><p class="when">' + n + ' of ' + P.length + ' answered</p>';
  if (n < P.length) o += '<button class="btn primary" data-do="resume">' + (n ? 'Continue' : 'Begin') + '</button>';
  ['you', 'child'].forEach(function (s) {
    o += '<p class="q">' + esc(fill(SEC[s])) + '</p><div class="stack">';
    P.forEach(function (p, i) { if (p.s !== s) return; var a = ans(i), t = latest(i);
      o += '<button class="rq' + (t ? ' done' : '') + '" data-do="gotoQ" data-arg="' + i + '"><i>' + (t ? '\u2713' : i + 1) + '</i><span><b>' + esc(fill(p.t)) + '</b>' + (t ? '<small>' + esc(cut(t, 80)) + '</small>' : drafts[i] ? '<small>Draft</small>' : '') + '</span></button>'; });
    o += '</div>';
  });
  return o;
}
function journalCard(d) {
  if (isShabbat(d)) return '<div class="card prompt-card shab"><p class="eyebrow">Shabbat</p><p class="serif">Nothing to fill in. Just be with them.</p></div>';
  var h = d.getHours();
  if (h >= 5 && h < 12 && !jToday('am')) return '<button class="card prompt-card" data-do="journal" data-arg="am"><p class="eyebrow">\u2600 Morning</p><p class="serif">Who do you want to be with the kids today?</p></button>';
  if ((h >= 20 || h < 3) && !jToday('pm')) return '<button class="card prompt-card eve" data-do="journal" data-arg="pm"><p class="eyebrow">\u263E Evening</p><p class="serif">What went right today?</p></button>';
  return '';
}

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
  var waiting = ms.filter(function (m) { return !m.data.fileId; }).length;
  if (waiting) o += '<p class="quiet">' + waiting + ' safe on this phone \u00b7 ' + (sync.state === 'ok' ? 'uploading\u2026' : 'will move to your private Drive once setup is done') + '</p>';
  if (!ms.length) return o + '<p class="empty">No memories yet.</p></div>';
  var cur = '';
  ms.slice(0, 60).forEach(function (m) { var d = m.data, dd = d.date || day(m.at);
    if (dd !== cur) { o += (cur ? '</div>' : '') + '<p class="tday">' + esc(new Date(dd + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) + '</p><div class="tl">'; cur = dd; }
    o += '<button class="mem" data-do="openMem" data-arg="' + m.id + '">' + (d.thumb ? '<span class="th" style="background-image:url(' + esc(d.thumb) + ')">' + (/^video/.test(d.mime) ? '<b>\u25B6</b>' : '') + '</span>' : '') +
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
    '<label class="lbl" for="mfile">Photos or videos</label><input id="mfile" type="file" accept="image/*,video/*" multiple>' +
    '<div class="tl">' + mem.files.map(function (f) { return '<span class="th sm" style="background-image:url(' + f.thumb + ')">' + (/^video/.test(f.mime) ? '<b>\u25B6</b>' : '') + '</span>'; }).join('') + '</div>' +
    '<label class="lbl">Proud\u2026</label><div class="chips">' + PROUD.map(function (p) { return '<button class="chip' + (p[0] === mem.proud ? ' on' : '') + '" data-do="memProud" data-arg="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
    '<textarea id="mnote" rows="3" placeholder="' + (mem.proud === 'me' ? 'What I\u2019m proud of in myself here\u2026' : mem.proud === 'from' ? 'What they did that made me proud\u2026' : 'What I\u2019m proud of in them\u2026') + '">' + esc(mem.note || '') + '</textarea>' +
    '<button class="btn primary" data-do="saveMem">Keep this memory</button><p class="quiet center">Private \u00b7 your Google Drive only</p></div>';
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
    .then(function () { toast('Kept. What a day.'); var f = mem.from; mem = null; overlay = f; render(); window.scrollTo(0, 0); mediaFlush(); })
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
on('rmMem', function (id) { if (!confirm('Remove this memory from the timeline? (Any uploaded file stays in your private Drive folder.)')) return; delEntry(id); close(); });

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
