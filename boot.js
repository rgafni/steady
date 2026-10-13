/* Reads the private link once (#k=key&api=deployment&c=name&kids=a,b,c), keeps it on this device only, and wipes it from the address bar. */
(function () {
  try {
    var h = new URLSearchParams((location.hash || '').replace(/^#/, '')), k = h.get('k'), api = h.get('api');
    if (k && /^[A-Za-z0-9_-]{20,128}$/.test(k)) localStorage.setItem('steady.k', k);
    if (api) { if (/^[A-Za-z0-9_-]{30,120}$/.test(api)) api = 'https://script.google.com/macros/s/' + api + '/exec';
      if (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(api) || /^http:\/\/(localhost|127\.0\.0\.1):\d+\/api$/.test(api)) localStorage.setItem('steady.api', api); }
    ['c', 'kids', 'spouse', 'ages'].forEach(function (p) { var v = h.get(p); if (v) localStorage.setItem('steady.' + p, v.slice(0, 80)); });
    if (location.hash) history.replaceState(null, '', location.pathname);
  } catch (e) {}
  window.addEventListener("hashchange", function () { if (/[#&]k=/.test(location.hash)) location.reload(); });
})();
