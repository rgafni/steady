(function () {
'use strict';
/* Steady v9. Today, What's on me, Tonight, the Friday card, and one page per area.
   Same storage and backend protocol as v8 (steady.snap + steady.q, ops to the private backend), so every v8 entry stays and shows on Father. */
var P = window.STEADY_PROMPTS || [], $app = document.getElementById('app');
var LS = localStorage, NATIVE = !!window.SteadyNative, K = LS.getItem('steady.k'), API = LS.getItem('steady.api') || (window.STEADY_CONFIG || {}).API_URL || '';
if (NATIVE) { K = K || 'device'; API = ''; }
function jget(k, d) { try { var v = JSON.parse(LS.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function jset(k, v) { try { LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { setTimeout(function () { toast('Phone storage is full. This was not saved.'); }, 0); return false; } }
var snap = jget('steady.snap', { config: {}, answers: [], entries: [], katya: [] }), queue = jget('steady.q', []), ui = jget('steady.ui', {});
var sync = { state: API ? 'idle' : 'local' };

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function NOW() { var f = LS.getItem('steady.fakeNow'); return f ? new Date(f) : new Date(); }
function nowStr(d) { d = d || NOW(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function day(s) { return String(s || '').slice(0, 10); }
function ymd(d) { return nowStr(d).slice(0, 10); }
function today() { return ymd(NOW()); }
function addDays(s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
function daysAgo(s) { return Math.round((new Date(today() + 'T12:00:00') - new Date(day(s) + 'T12:00:00')) / 864e5); }
function niceDate(s) { var d = new Date(day(s) + 'T12:00:00'); if (isNaN(d)) return ''; var n = daysAgo(s);
  if (n === 0) return NOW().getHours() >= 17 && String(s).slice(11, 13) >= '17' ? 'Tonight' : 'Today'; if (n === 1) return 'Yesterday';
  if (n > 1 && n < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', d.getFullYear() === NOW().getFullYear() ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' }); }
function longDay(s) { return new Date(day(s) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.className = 'on'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 2200); }
function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }

/* ---------- data: server snapshot + pending ops (unchanged from v8) ---------- */
function view() {
  var v = { config: Object.assign({}, snap.config), answers: (snap.answers || []).slice(), entries: (snap.entries || []).slice() };
  queue.forEach(function (op) {
    if (op.t === 'answer' && !v.answers.some(function (a) { return a.id === op.id; })) v.answers.push({ id: op.id, at: op.at, q: op.q, text: op.text });
    if (op.t === 'entry') { v.entries = v.entries.filter(function (e) { return e.id !== op.eid; }); if (!op.del) v.entries.push({ id: op.eid, at: op.at, type: op.type, data: op.data }); }
  });
  return v;
}
var V = view();
function byId(id) { return V.entries.filter(function (e) { return e.id === id; })[0]; }
function ofType(t) { return V.entries.filter(function (e) { return e.type === t; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }); }
function push(op) { op.id = op.id || uid(); op.at = op.at || nowStr(); queue.push(op); jset('steady.q', queue); V = view(); flush(); }
function put(type, data, eid, at) { push({ t: 'entry', type: type, data: data, eid: eid || uid(), at: at }); }
function del(eid) { push({ t: 'entry', eid: eid, del: true, type: '', data: {} }); }
function pend() { return queue.filter(function (o) { return o.t !== 'ask'; }); } /* old Ask Katya items stay stored, never sent */
function kids() { return (V.config.kids || LS.getItem('steady.kids') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
function child() { return V.config.child || LS.getItem('steady.c') || ''; }

var flushing = false;
function flush(force) {
  if (!API || !K || flushing) { if (!API) sync.state = 'local'; return; }
  var ops = pend(); if (!ops.length && !force) return;
  flushing = true; sync.state = 'syncing';
  post({ ops: ops }).then(function (j) {
    snap = j.result; jset('steady.snap', snap);
    queue = queue.filter(function (o) { return ops.indexOf(o) < 0; }); jset('steady.q', queue);
    sync.state = 'ok'; setTimeout(mediaFlush, 0);
  }).catch(function () { sync.state = 'offline'; })
    .then(function () { flushing = false; V = view(); var a = document.activeElement; if (!a || !/TEXTAREA|INPUT/.test(a.tagName)) render(); if (pend().length && sync.state === 'ok') flush(); });
}
function post(body) { return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store', body: JSON.stringify(Object.assign({ k: K }, body)) })
  .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || 'error'); return j; }); }
function syncLine() {
  if (sync.state === 'ok') return 'Saved privately';
  if (sync.state === 'syncing') return 'Saving privately';
  return pend().length && API ? 'Saved on this phone. Not synced yet' : 'Saved on this phone';
}

/* ---------- photos and videos kept from v8 (IndexedDB, same store) ---------- */
var idb = null, localURL = {};
function db() { if (idb) return idb; idb = new Promise(function (res, rej) { var r = indexedDB.open('steady-media', 1); r.onupgradeneeded = function () { r.result.createObjectStore('m', { keyPath: 'id' }); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return idb; }
function idbDo(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('m', mode), s = t.objectStore('m'), r = fn(s); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }); }
function mediaAll() { return window.indexedDB ? idbDo('readonly', function (s) { return s.getAll(); }).then(function (a) { return a || []; }, function () { return []; }) : Promise.resolve([]); }
function b64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
var mflushing = false;
function mediaFlush() {
  if (!API || !K || mflushing || sync.state !== 'ok' || !window.indexedDB) return;
  mflushing = true; var sent = 0;
  mediaAll().then(function (all) { return all.reduce(function (p, it) { return p.then(function () {
    if (queue.some(function (o) { return o.eid === it.eid; })) return;
    return b64(it.blob).then(function (data) { return post({ media: { id: it.id, eid: it.eid, mime: it.mime, name: it.name, who: it.who, date: it.date, b64: data } }); })
      .then(function () { sent++; return idbDo('readwrite', function (s) { return s.delete(it.id); }); });
  }); }, Promise.resolve()); }).then(function () { if (sent) flush(true); }, function () {}).then(function () { mflushing = false; });
}
function loadMedia(e) {
  if (localURL[e.id] !== undefined || !e.data.mime) return;
  localURL[e.id] = null;
  function done(u) { localURL[e.id] = u || false; render(); }
  mediaAll().then(function (all) { var it = all.filter(function (x) { return x.eid === e.id; })[0];
    if (it) return done(URL.createObjectURL(it.blob));
    if (!e.data.fileId || !API) return done(false);
    return post({ get: e.data.fileId }).then(function (j) { if (!j.file.b64) return done(false); var bin = atob(j.file.b64), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); done(URL.createObjectURL(new Blob([u8], { type: j.file.mime }))); });
  }).catch(function () { done(false); });
}

/* ---------- areas ---------- */
var AREAS = [['avodah', 'Avodah', 'Avodah'], ['father', 'Father', 'Father'], ['marriage', 'Marriage', 'Marriage'], ['body', 'Body and health', 'Body'], ['work', 'Work', 'Work']];
var PLACE = { avodah: 'in avodah', father: 'at home', marriage: 'in my marriage', body: 'in my body', work: 'at work' };
function areaName(a) { var x = AREAS.filter(function (r) { return r[0] === a; })[0]; return x ? x[1] : ''; }
function stepOf(a) { var e = byId('step_' + a); return e ? String(e.data.text || '') : ''; }

/* Every v8 entry, in one shape, so it shows on Father (and on each child's page). Nothing is dropped. */
var JF = [['intention', 'Wanted to be'], ['grateful', 'Grateful for'], ['proud', 'Proud of'], ['moment', 'A moment'], ['gave', 'I gave them'], ['care', 'For myself'], ['love', 'I love'], ['kinder', 'Kinder version']];
var V8 = { moment: ['text', 'Moment'], love: ['text', 'Noticed'], win: ['label', 'Did well'], reframe: ['text', 'Kinder version'], parked: ['text', 'Set down'], memory: ['note', 'Memory'], letter: ['text', 'Letter'], need: ['text', 'Needs'] };
function item(e) {
  var d = e.data || {}, t = e.type, ks = kids();
  function who(list) { return list.filter(function (k, i) { return k && ks.indexOf(k) >= 0 && list.indexOf(k) === i; }); }
  if (t === 'note') return { e: e, area: d.area, label: '', text: d.text, kids: who(d.kids || []) };
  if (t === 'onme') return { e: e, areas: [d.from, d.to], label: '', text: d.text, tag: d.from && d.to ? (d.from === d.to ? 'Started and landed ' + PLACE[d.to] : 'Started ' + PLACE[d.from] + ', landed ' + PLACE[d.to]) : d.from ? 'Started ' + PLACE[d.from] : '' };
  if (t === 'night') return { e: e, area: 'avodah', label: 'Tonight', when: d.date, text: [d.good, d.hand ? 'Handed over: ' + d.hand : ''].filter(Boolean).join('\n') };
  if (t === 'journal') { var f = JF.filter(function (y) { return d[y[0]]; });
    return { e: e, area: 'father', v8: true, label: d.kind === 'am' ? 'Morning journal' : 'Evening journal', text: f.map(function (y) { return y[1] + ': ' + d[y[0]]; }).join('\n'), kids: who((d.about || []).concat([d.kid, d.momentKid, d.loveKid])) }; }
  if (t === 'moment' && /^jm_/.test(e.id) || t === 'love' && /^jl_/.test(e.id)) return null; /* shown inside their journal */
  if (V8[t]) return { e: e, area: 'father', v8: true, label: t === 'letter' ? 'Letter' + (d.occasion ? ', ' + d.occasion : '') : t === 'moment' && d.tag && d.tag !== 'From journal' ? d.tag : V8[t][1], text: d[V8[t][0]], kids: who([d.kid]), when: t === 'memory' ? d.date : '', thumb: d.thumb };
  if (t === 'selfcheck') return { e: e, area: 'father', v8: true, label: 'How I treated myself', text: ({ gentle: 'Gently', okay: 'Getting by', hard: 'Hard on myself' })[d.tone] || '' };
  if (t === 'plan') return { e: e, area: 'father', v8: true, label: 'Self-care plan', text: (d.items || []).join('\n') };
  return null;
}
function items() {
  var out = []; V.entries.forEach(function (e) { var it = item(e); if (it && (String(it.text || '').trim() || it.thumb)) out.push(it); });
  V.answers.forEach(function (a) { var p = P[a.q]; if (!p || !String(a.text || '').trim()) return;
    out.push({ ans: a, e: { id: a.id, at: a.at }, area: 'father', v8: true, label: 'Reflection', prompt: String(p.t).replace(/\{c\}/g, child() || 'her'), text: a.text, kids: p.s === 'child' && child() ? [child()] : [] }); });
  return out.sort(function (a, b) { var x = (a.when || day(a.e.at)) + a.e.at, y = (b.when || day(b.e.at)) + b.e.at; return x < y ? 1 : -1; });
}
function inArea(a) { return items().filter(function (it) { return it.area === a || (it.areas && it.areas.indexOf(a) >= 0); }); }
function aboutKid(k) { return items().filter(function (it) { return (it.kids || []).indexOf(k) >= 0; }); }

/* ---------- time ---------- */
function isFriday() { return NOW().getDay() === 5; }
function isEvening() { var h = NOW().getHours(); return h >= 19 || h < 4; }
function nightDate() { var d = NOW(); if (d.getHours() < 4) d = new Date(+d - 864e5); return ymd(d); }
function weekFri() { var t = today(), w = NOW().getDay(); return addDays(t, (5 - w + 7) % 7); }

/* ---------- navigation (Android back button works) ---------- */
var stack = [{ s: 'today' }];
function cur() { return stack[stack.length - 1]; }
function go(s, arg) { stack.push({ s: s, a: arg }); history.pushState({ d: stack.length }, ''); render(); window.scrollTo(0, 0); }
function back() { if (stack.length > 1) history.back(); else { stack = [{ s: 'today' }]; render(); } }
function home() { var n = stack.length - 1; stack = [{ s: 'today' }]; if (n > 0) history.go(-n); render(); window.scrollTo(0, 0); }
window.addEventListener('popstate', function () { if (stack.length > 1) { stack.pop(); render(); window.scrollTo(0, 0); } });

var H = {};
function on(n, f) { H[n] = f; }
function bind() {
  $app.querySelectorAll('[data-do]').forEach(function (b) { b.onclick = function (ev) { if (b.tagName === 'A') return; ev.preventDefault(); var h = H[b.dataset.do]; if (h) h(b.dataset.arg, b); }; });
  $app.querySelectorAll('textarea').forEach(function (t) { size(t); t.addEventListener('input', function () { size(t); if (t.dataset.live) H[t.dataset.live](t); }); });
}
function size(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
var BACK = '<button class="back" data-do="back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

/* ---------- 1. Today ---------- */
function vToday() {
  var g = byId('g_' + today()), om = ofType('onme').filter(function (e) { return day(e.at) === today(); })[0];
  var wk = byId('w_' + weekFri()), nt = byId('n_' + nightDate()), nudge = '';
  if (isFriday() && !wk) nudge = '<button class="nudge" data-do="go" data-arg="friday">Before Shabbos: your week, in three questions</button>';
  else if (isEvening() && !nt) nudge = '<button class="nudge" data-do="go" data-arg="tonight">Tonight: one good point</button>';
  return '<div class="scr"><p class="eyebrow">' + esc(longDay(today())) + '</p>' + nudge +
    '<div class="grat"><label class="lbl" for="grat">Today I\u2019m grateful for</label><textarea id="grat" class="serif" rows="1" placeholder="One line, big or small." data-live="gratLive" data-day="' + today() + '">' + esc(g ? g.data.text : '') + '</textarea></div>' +
    '<button class="onme" data-do="go" data-arg="onme"><span class="t">What\u2019s on me</span><span class="p' + (om ? ' has' : '') + '">' + esc(om ? om.data.text : 'Anything you\u2019re carrying?') + '</span></button>' +
    '<p class="eyebrow steps">One step in each</p><div>' +
    AREAS.map(function (a) { var s = stepOf(a[0]); return '<button class="row" data-do="go" data-arg="area|' + a[0] + '"><div class="a">' + a[1] + '</div><div class="s' + (s ? '' : ' none') + '">' + esc(s || 'Choose one small step') + '</div></button>'; }).join('') +
    '</div><div class="grow"></div><div class="foot"><button data-do="go" data-arg="talk">Talk to someone</button><button class="sync" data-do="go" data-arg="data">' + esc(syncLine()) + ' \u00b7 Save a copy</button></div></div>';
}
var gT = null;
on('gratLive', function (t) { t.dataset.dirty = '1'; clearTimeout(gT); gT = setTimeout(function () { saveGrat(t); }, 700); });
/* Saves only what was typed, and only to the day the line was shown for (never carries a line across midnight). */
function saveGrat(t) { if (!t || t.dataset.dirty !== '1') return; t.dataset.dirty = ''; var v = String(t.value || '').trim(), id = 'g_' + t.dataset.day, ex = byId(id); if (ex ? ex.data.text === v : !v) return; if (!v) { del(id); return; } put('grat', { text: v }, id, ex ? ex.at : null); }

/* ---------- 2. What's on me ---------- */
var om = null;
function vOnme() {
  if (!om) om = { text: '', from: '', to: '' };
  function chips(k) { return '<div class="chips">' + AREAS.map(function (a) { return '<button class="chip' + (om[k] === a[0] ? ' on' : '') + '" data-do="omPick" data-arg="' + k + '|' + a[0] + '">' + a[2] + '</button>'; }).join('') + '</div>'; }
  var kept = om.from && om.to ? 'Kept as <b>started ' + PLACE[om.from] + ', landed ' + PLACE[om.to] + '.</b><br>' + (om.from === om.to ? 'It will show on ' + areaName(om.to) + '.' : 'It will show on ' + areaName(om.to) + ' and on ' + areaName(om.from) + '.') : 'Tap where it started and where it landed. Either can wait.';
  return '<div class="scr"><div class="bar"><button class="c" data-do="back">Cancel</button><button class="s" data-do="omSave">Save</button></div>' +
    '<label class="lbl wl" for="omt">What\u2019s on me</label><textarea id="omt" class="txt" rows="2" placeholder="Write it as it is.">' + esc(om.text) + '</textarea>' +
    '<p class="q">Where did this start?</p>' + chips('from') + '<p class="q" style="margin-top:30px">Where did it land?</p>' + chips('to') +
    '<p class="kept">' + kept + '</p><p class="priv">Private. Only you see this.</p></div>';
}
on('omPick', function (a) { var p = a.split('|'); om.text = document.getElementById('omt').value; om[p[0]] = om[p[0]] === p[1] ? '' : p[1]; render(); });
on('omSave', function () { var t = val('omt'); if (!t) { toast('Write a few words first'); return; } put('onme', { text: t, from: om.from, to: om.to }); om = null; toast('Kept'); back(); });

/* ---------- 3. Tonight (nightly avodah) ---------- */
var MISHLEI = 'כִּי שֶׁבַע יִפּוֹל צַדִּיק וָקָם';
function vTonight() {
  var n = byId('n_' + nightDate()), d = n ? n.data : {};
  return '<div class="scr"><div class="bar"><p class="eyebrow">Tonight</p><button class="c" data-do="back">Close</button></div>' +
    '<p class="he" lang="he" dir="rtl">' + MISHLEI + '</p><p class="he-en">A righteous person falls seven times and rises.</p>' +
    '<p class="q1">Find one good point in yourself today.</p><textarea id="ng" class="a1" rows="1" placeholder="Something small is enough.">' + esc(d.good || '') + '</textarea>' +
    '<p class="q2">Anything to hand over before sleep?</p><textarea id="nh" class="a2" rows="1" placeholder="Write it, or just let it go.">' + esc(d.hand || '') + '</textarea>' +
    '<button class="btn" data-do="nightSave">Good night</button></div>';
}
on('nightSave', function () { var g = val('ng'), h = val('nh'), id = 'n_' + nightDate(), ex = byId(id);
  if (g || h) put('night', { good: g, hand: h, date: nightDate() }, id, ex ? ex.at : null); else if (ex) del(id);
  toast('Good night'); home(); });

/* ---------- 4. Friday card (the weekly look) ---------- */
var WQ = [['well', 'Where did I show up well?'], ['crowd', 'Where did one area crowd out another?'], ['change', 'One thing to change next week']];
function vFriday() {
  var f = weekFri(), w = byId('w_' + f), d = w ? w.data : {};
  var past = ofType('week').filter(function (x) { return x.id !== 'w_' + f; });
  return '<div class="scr"><div class="bar"><p class="eyebrow">Friday, before Shabbos</p><button class="c" data-do="back">Close</button></div>' +
    '<h1 class="title">Your week, in three questions.</h1><p class="sub">A few minutes. Then put it down.</p>' +
    WQ.map(function (q, i) { return '<div class="blk"><div class="n">' + (i + 1) + '</div><div class="qq">' + q[1] + '</div><textarea id="w_' + q[0] + '" rows="1" placeholder="Write one line">' + esc(d[q[0]] || '') + '</textarea></div>'; }).join('') +
    '<div class="grow"></div><button class="btn primary" style="margin-top:36px" data-do="weekSave">Done for the week</button><p class="gs">Good Shabbos</p>' +
    (past.length ? '<p class="eyebrow earlier">Earlier weeks</p>' + past.map(function (x) { var y = x.data; return '<button class="e" data-do="go" data-arg="entry|' + x.id + '"><div class="b"><div class="d">Week of ' + esc(longDay(y.fri || x.at)) + '</div><div class="x">' + esc(WQ.map(function (q) { return y[q[0]]; }).filter(Boolean).join('\n')) + '</div></div></button>'; }).join('') : '') + '</div>';
}
on('weekSave', function () { var f = weekFri(), id = 'w_' + f, ex = byId(id), d = { fri: f }, any = false;
  WQ.forEach(function (q) { d[q[0]] = val('w_' + q[0]); if (d[q[0]]) any = true; });
  if (!any) { toast('Write one line first'); return; } put('week', d, id, ex ? ex.at : null); toast('Good Shabbos'); home(); });

/* ---------- 5. One area ---------- */
function list(its, emptyMsg) {
  if (!its.length) return '<p class="empty">' + emptyMsg + '</p>';
  return '<div>' + its.map(function (it) {
    return '<button class="e" data-do="go" data-arg="entry|' + esc(it.e.id) + '">' + (it.thumb ? '<span class="th" style="background-image:url(' + esc(it.thumb) + ')"></span>' : '') +
      '<div class="b"><div class="d">' + esc(niceDate(it.when || it.e.at)) + (it.label ? ' \u00b7 ' + esc(it.label) : '') + '</div><div class="x">' + esc(String(it.text || '').length > 320 ? String(it.text).slice(0, 318) + '\u2026' : it.text) + '</div>' + (it.tag ? '<div class="tag">' + esc(it.tag) + '</div>' : '') + '</div></button>'; }).join('') + '</div>';
}
function vArea(a) {
  var s = stepOf(a), extra = '';
  if (a === 'father' && kids().length) extra = '<div class="kids">' + kids().map(function (k) { return '<button class="kid" data-do="go" data-arg="kid|' + esc(k) + '">' + esc(k) + '\u2019s page</button>'; }).join('') + '</div>';
  if (a === 'avodah') extra = '<div class="kids"><button class="kid" data-do="go" data-arg="tonight">Tonight</button></div>';
  return '<div class="scr">' + BACK + 'Today</button><h1 class="name">' + areaName(a) + '</h1>' +
    '<p class="sl">This week\u2019s step</p><button class="step' + (s ? '' : ' none') + '" data-do="go" data-arg="step|' + a + '">' + esc(s || 'Choose one small step') + '</button>' + extra +
    '<p class="eyebrow wh">Written here</p>' + list(inArea(a), 'Nothing written here yet.') +
    '<div style="height:90px"></div><button class="fab" aria-label="Write here" data-do="go" data-arg="write|' + a + '"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button></div>';
}
function vKid(k) {
  return '<div class="scr">' + BACK + 'Father</button><h1 class="name">' + esc(k) + '</h1><p class="sl">Everything written about ' + esc(k) + ', newest first.</p>' +
    '<div style="margin-top:14px"></div>' + list(aboutKid(k), 'Nothing about ' + esc(k) + ' yet.') + '</div>';
}
function vStep(a) {
  return '<div class="scr"><div class="bar"><button class="c" data-do="back">Cancel</button><button class="s" data-do="stepSave" data-arg="' + a + '">Save</button></div>' +
    '<label class="lbl wl" for="stp">' + areaName(a) + ', one small step</label><textarea id="stp" class="txt" rows="2" placeholder="Small enough to do this week.">' + esc(stepOf(a)) + '</textarea>' +
    '<p class="note">In your own words. You can change it any time.</p></div>';
}
on('stepSave', function (a) { var t = val('stp'), ex = byId('step_' + a); if (!t && ex) del('step_' + a); else if (t) put('step', { area: a, text: t }, 'step_' + a); back(); });
var wkids = [];
function vWrite(a) {
  return '<div class="scr"><div class="bar"><button class="c" data-do="back">Cancel</button><button class="s" data-do="noteSave" data-arg="' + a + '">Save</button></div>' +
    '<label class="lbl wl" for="nt">' + areaName(a) + '</label><textarea id="nt" class="txt" rows="3" placeholder="Write it as it is."></textarea>' +
    (a === 'father' && kids().length ? '<p class="q">About <span style="color:var(--mute);font-weight:400">(optional)</span></p><div class="chips">' + kids().map(function (k) { return '<button class="chip' + (wkids.indexOf(k) >= 0 ? ' on' : '') + '" data-do="wkid" data-arg="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' : '') +
    '<p class="priv">Private. Only you see this.</p></div>';
}
on('wkid', function (k) { var t = document.getElementById('nt').value, i = wkids.indexOf(k); if (i >= 0) wkids.splice(i, 1); else wkids.push(k); render(); document.getElementById('nt').value = t; });
on('noteSave', function (a) { var t = val('nt'); if (!t) { toast('Write a few words first'); return; } put('note', { area: a, text: t, kids: wkids.slice() }); wkids = []; toast('Kept'); back(); });

/* ---------- one entry: edit, or delete after a confirm ---------- */
var confirmDel = null;
function fieldsOf(e) {
  var d = e.data || {}, t = e.type;
  if (t === 'journal') return JF.filter(function (y) { return d[y[0]] != null && d[y[0]] !== ''; }).map(function (y) { return [y[0], y[1], d[y[0]]]; });
  if (t === 'note' || t === 'onme') return [['text', '', d.text]];
  if (t === 'night') return [['good', 'One good point', d.good || ''], ['hand', 'Handed over', d.hand || '']];
  if (t === 'week') return WQ.map(function (q) { return [q[0], q[1], d[q[0]] || '']; });
  if (t === 'plan') return [['items', 'Self-care plan, one per line', (d.items || []).join('\n')]];
  if (V8[t]) return [[V8[t][0], '', d[V8[t][0]] || '']];
  return [];
}
function vEntry(id) {
  var e = byId(id), ans = !e && V.answers.filter(function (a) { return a.id === id; })[0];
  if (ans) { var p = P[ans.q] || { t: '' };
    return '<div class="scr">' + BACK + 'Back</button><p class="sl" style="margin-top:26px">' + esc(niceDate(ans.at)) + ' \u00b7 Reflection</p><p class="p" style="color:var(--mute)">' + esc(String(p.t).replace(/\{c\}/g, child() || 'her')) + '</p>' +
      '<p class="big" style="font-size:22px;white-space:pre-line">' + esc(ans.text) + '</p><p class="note" style="margin-top:30px">Reflection answers are kept as they were, so the history stays.</p></div>'; }
  if (!e) return '<div class="scr">' + BACK + 'Back</button><p class="empty">This entry is gone.</p></div>';
  var it = item(e) || {}, fs = fieldsOf(e), d = e.data || {}, media = '';
  if (d.mime) { loadMedia(e); var u = localURL[e.id]; media = '<div class="media">' + (u ? (/^video/.test(d.mime) ? '<video src="' + u + '" controls playsinline></video>' : '<img src="' + u + '" alt="">') : d.thumb ? '<img src="' + esc(d.thumb) + '" alt="">' : '') + '</div>'; }
  var o = '<div class="scr"><div class="bar"><button class="c" data-do="back">Cancel</button>' + (fs.length ? '<button class="s" data-do="entrySave" data-arg="' + esc(id) + '">Save</button>' : '<span></span>') + '</div>' +
    '<p class="sl" style="margin-top:30px">' + esc(longDay(it.when || d.date || d.fri || e.at)) + (it.label ? ' \u00b7 ' + esc(it.label) : '') + (d.edited ? ' \u00b7 Edited' : '') + '</p>' + media +
    fs.map(function (f, i) { return '<div class="fld">' + (f[1] ? '<label class="lbl" for="f' + i + '">' + esc(f[1]) + '</label>' : '') + '<textarea id="f' + i + '" class="txt sm" rows="1">' + esc(f[2]) + '</textarea></div>'; }).join('') +
    (fs.length ? '' : '<p class="big" style="font-size:22px">' + esc(it.text || '') + '</p>') +
    (it.tag ? '<p class="note">' + esc(it.tag) + '</p>' : '');
  if (confirmDel === id) {
    var extra = e.type === 'journal' && (byId('jm_' + id) || byId('jl_' + id)) ? ' The moment and letter line it added go too.' : '';
    extra += d.mime && !d.fileId ? ' Its photo or video on this phone goes too.' : d.fileId ? ' The file in your private Drive folder stays.' : '';
    o += '<div class="confirm"><p>Delete this entry from ' + esc(longDay(it.when || e.at)) + '?' + extra + ' Copies you saved before still have it.</p><div class="two"><button class="btn line" data-do="keepIt">Keep it</button><button class="btn danger" data-do="delIt" data-arg="' + esc(id) + '">Delete</button></div></div>';
  } else o += '<button class="del" data-do="askDel" data-arg="' + esc(id) + '">Delete</button>';
  return o + '</div>';
}
on('askDel', function (id) { confirmDel = id; render(); window.scrollTo(0, document.body.scrollHeight); });
on('keepIt', function () { confirmDel = null; render(); });
on('delIt', function (id) { var e = byId(id); confirmDel = null; if (!e) { back(); return; }
  del(id); if (e.type === 'journal') { if (byId('jm_' + id)) del('jm_' + id); if (byId('jl_' + id)) del('jl_' + id); }
  if (e.data && e.data.mime) mediaAll().then(function (all) { all.filter(function (x) { return x.eid === id; }).forEach(function (x) { idbDo('readwrite', function (s) { return s.delete(x.id); }); }); });
  toast('Deleted'); back(); });
on('entrySave', function (id) {
  var e = byId(id); if (!e) { back(); return; }
  var d = Object.assign({}, e.data), fs = fieldsOf(e), changed = false;
  fs.forEach(function (f, i) { var v = (document.getElementById('f' + i) || {}).value; if (v == null) return; v = f[0] === 'items' ? v.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean) : v.trim();
    if (JSON.stringify(v) !== JSON.stringify(f[0] === 'items' ? (d.items || []) : (d[f[0]] || ''))) { d[f[0]] = v; changed = true; } });
  if (!changed) { back(); return; }
  d.edited = nowStr(); put(e.type, d, e.id, e.at);
  /* a journal's moment and letter line follow its edit, as in v8 */
  if (e.type === 'journal') { var m = byId('jm_' + id), l = byId('jl_' + id);
    if (m) { if (d.moment) put('moment', Object.assign({}, m.data, { text: d.moment }), m.id, m.at); else del(m.id); }
    if (l) { if (d.love) put('love', Object.assign({}, l.data, { text: d.love }), l.id, l.at); else del(l.id); } }
  toast('Saved'); back(); });

/* ---------- Talk to someone ---------- */
function people() { return jget('steady.people', { rav: { name: '', num: '' }, trust: { name: '', num: '' } }); }
var editP = null;
function telOf(n) { return String(n || '').replace(/[^\d+]/g, ''); }
function vTalk() {
  var pp = people();
  function row(k, title) { var p = pp[k];
    if (editP === k) return '<div class="pl"><div class="t">' + title + '</div><input id="pn" class="inp" placeholder="Name" value="' + esc(p.name) + '"><input id="pt" class="inp" type="tel" placeholder="Phone number" value="' + esc(p.num) + '"><div class="chips"><button class="chip on" data-do="pSave" data-arg="' + k + '">Save</button><button class="chip" data-do="pCancel">Cancel</button></div></div>';
    if (!p.num) return '<button class="pl" data-do="pEdit" data-arg="' + k + '"><div class="t">' + title + '</div><div class="s">Add a number, kept on this phone</div></button>';
    return '<div class="pl"><div class="t">' + esc(p.name || title) + '</div><div class="s" style="margin-top:8px"><a href="tel:' + esc(telOf(p.num)) + '">Call</a><a href="sms:' + esc(telOf(p.num)) + '">Text</a><button class="s" style="color:var(--mute)" data-do="pEdit" data-arg="' + k + '">Change</button></div></div>'; }
  return '<div class="scr">' + BACK + 'Today</button><h1 class="name">Talk to someone</h1><p class="p">You don\u2019t have to carry it alone. For a hard moment or a halachic question, reach out to a person.</p><div style="margin-top:18px">' +
    row('rav', 'Your Rav') + row('trust', 'Someone you trust') +
    '<div class="pl"><div class="t">988 Suicide and Crisis Lifeline</div><div class="s">Any time, free and private.</div><div class="s" style="margin-top:8px"><a href="tel:988">Call 988</a><a href="sms:988">Text 988</a></div></div>' +
    '<div class="pl" style="border:0"><div class="t">In danger right now</div><div class="s" style="margin-top:8px"><a href="tel:911">Call 911</a></div></div></div></div>';
}
on('pEdit', function (k) { editP = k; render(); });
on('pCancel', function () { editP = null; render(); });
on('pSave', function (k) { var pp = people(); pp[k] = { name: val('pn').slice(0, 40), num: val('pt').slice(0, 24) }; jset('steady.people', pp); editP = null; render(); });

/* ---------- Your data: Save a copy / Restore (kept from v8, same file format) ---------- */
var COPY_KEYS = ['steady.q', 'steady.snap', 'steady.drafts', 'steady.c', 'steady.kids', 'steady.ages', 'steady.spouse', 'steady.people'], copyMsg = '';
function vData() {
  var n = V.entries.length + V.answers.length, last = ui.lastCopy;
  return '<div class="scr">' + BACK + 'Today</button><h1 class="name">Your data</h1>' +
    '<p class="p">' + esc(syncLine()) + '. ' + plural(n, 'entry', 'entries') + '.</p><p class="note">' + (last ? 'Last copy saved ' + esc(niceDate(last)) + '.' : 'No copy saved yet.') + '</p>' +
    '<button class="btn primary" style="margin-top:28px" data-do="saveCopy">Save a copy</button><p class="note">One file in your Downloads, with your words and photos. It is not locked, so keep it somewhere private. Nothing is sent anywhere.</p>' +
    '<label class="btn line" style="margin-top:22px" for="copyfile">Restore from a copy</label><input id="copyfile" type="file" accept=".json,application/json" hidden><p class="note">Adds what is in the file. Nothing on this phone is deleted.</p>' +
    (copyMsg ? '<p class="p" style="color:var(--accent)">' + esc(copyMsg) + '</p>' : '') + '</div>';
}
on('saveCopy', function (_, btn) {
  btn.disabled = true; btn.textContent = 'Saving';
  var data = {}; COPY_KEYS.forEach(function (k) { var v = LS.getItem(k); if (v != null) data[k] = v; });
  mediaAll().then(function (all) { return Promise.all(all.map(function (m) { return b64(m.blob).then(function (x) { return { id: m.id, eid: m.eid, mime: m.mime, name: m.name, who: m.who, date: m.date, b64: x }; }, function () { return null; }); })); })
  .then(function (media) {
    media = media.filter(Boolean);
    var parts = [JSON.stringify({ format: 'steady-copy', version: 1, savedAt: nowStr(), data: data }).slice(0, -1), ',"media":['];
    media.forEach(function (m, i) { parts.push((i ? ',' : '') + JSON.stringify(m)); }); parts.push(']}');
    var blob = new Blob(parts, { type: 'application/json' }), nm = 'steady-copy-' + today() + '.json', a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = nm; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
    ui.lastCopy = nowStr(); jset('steady.ui', ui);
    copyMsg = 'Saved ' + nm + ' (' + (blob.size > 1e6 ? (blob.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1e3)) + ' KB') + ').'; render();
  }).catch(function () { copyMsg = 'Could not save the copy. Nothing changed.'; render(); });
});
function mergeById(a, b, key) { var seen = {}, out = (a || []).slice(); out.forEach(function (x) { seen[x[key]] = 1; }); (b || []).forEach(function (x) { if (x && x[key] != null && !seen[x[key]]) { seen[x[key]] = 1; out.push(x); } }); return out; }
$app.addEventListener('change', function (ev) {
  if (ev.target.id !== 'copyfile' || !ev.target.files || !ev.target.files[0]) return;
  ev.target.files[0].text().then(function (t) {
    var c = JSON.parse(t); if (!c || c.format !== 'steady-copy' || !c.data) throw new Error('not a copy');
    var d = c.data, inQ = JSON.parse(d['steady.q'] || '[]'), inS = JSON.parse(d['steady.snap'] || '{}');
    if (!Array.isArray(inQ)) throw new Error('bad');
    var media = (c.media || []).filter(function (m) { return m && m.id && m.b64 && /^(image|video)\//.test(m.mime || ''); });
    var newOps = inQ.filter(function (o) { return o && o.id && !queue.some(function (x) { return x.id === o.id; }); }).length;
    if (!confirm('Restore from the copy saved ' + niceDate(c.savedAt) + '? It adds ' + plural(newOps, 'item') + ' and ' + plural(media.length, 'photo or video', 'photos and videos') + '. Nothing here is deleted.')) return 'cancel';
    var mq = mergeById(queue, inQ, 'id').map(function (o, i) { return { o: o, i: i }; });
    mq.sort(function (x, y) { var a = String(x.o.at || ''), b = String(y.o.at || ''); return a < b ? -1 : a > b ? 1 : x.i - y.i; });
    var ns = { config: Object.assign({}, inS.config || {}, snap.config || {}), answers: mergeById(snap.answers, inS.answers, 'id'), entries: mergeById(snap.entries, inS.entries, 'id'), katya: mergeById(snap.katya, inS.katya, 'id') };
    if (!jset('steady.q', mq.map(function (x) { return x.o; })) || !jset('steady.snap', ns)) throw new Error('full');
    queue = mq.map(function (x) { return x.o; }); snap = ns;
    ['steady.c', 'steady.kids', 'steady.ages', 'steady.spouse', 'steady.people'].forEach(function (k) { if (d[k] && !LS.getItem(k)) LS.setItem(k, d[k]); });
    return mediaAll().then(function (have) { var ids = {}; have.forEach(function (m) { ids[m.id] = 1; });
      return media.filter(function (m) { return !ids[m.id]; }).reduce(function (p, m) { return p.then(function () {
        var bin = atob(m.b64), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return idbDo('readwrite', function (s) { return s.put({ id: m.id, eid: m.eid, blob: new Blob([u8], { type: m.mime }), mime: m.mime, name: m.name, who: m.who, date: m.date }); }); }); }, Promise.resolve()); }).then(function () { return 'ok'; });
  }).then(function (r) { if (r === 'cancel') return; V = view(); copyMsg = 'Restored. Everything from the copy is here.'; render(); flush(); })
    .catch(function (e) { copyMsg = String(e && e.message) === 'full' ? 'Phone storage is full. The restore did not finish. Nothing was deleted.' : 'That file is not a Steady copy. Nothing changed.'; render(); });
});

/* ---------- router ---------- */
on('back', back);
on('go', function (a) { var p = String(a).split('|'); if (p[0] === 'onme') om = null; if (p[0] === 'write') wkids = []; if (p[0] === 'data') copyMsg = ''; confirmDel = null; editP = null; go(p[0], p.slice(1).join('|')); });
function render() {
  V = view();
  clearTimeout(gT); saveGrat(document.getElementById('grat'));
  if (!K) { document.body.className = ''; $app.innerHTML = '<div class="locked"><h1>Steady</h1><p>This is a private app. Open it from your personal link.</p></div>'; return; }
  var c = cur(), html = ({ today: vToday, onme: vOnme, tonight: vTonight, friday: vFriday, area: vArea, kid: vKid, step: vStep, write: vWrite, entry: vEntry, talk: vTalk, data: vData })[c.s] || vToday;
  document.body.className = c.s === 'tonight' ? 'dark' : '';
  $app.innerHTML = c.s === 'tonight' ? '<div class="night">' + html(c.a) + '</div>' : html(c.a);
  bind();
}
document.addEventListener('visibilitychange', function () { if (document.hidden) saveGrat(document.getElementById('grat')); else if (cur().s === 'today' && !document.activeElement.matches('textarea,input')) render(); });
window.addEventListener('pagehide', function () { saveGrat(document.getElementById('grat')); });
var first = sessionStorage.getItem('steady.open'); sessionStorage.removeItem('steady.open');
history.replaceState({ d: 1 }, '');
render();
if (first === 'friday' || first === 'tonight') go(first);
window.addEventListener('hashchange', function () { var r = location.hash.replace(/^#/, ''); if (r === 'friday' || r === 'tonight') { history.replaceState(history.state, '', location.pathname); go(r); } });
flush(true);
if ('serviceWorker' in navigator && !NATIVE && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
