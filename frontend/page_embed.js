// Standalone iframe embed widget (#39). Reads a scoped token from ?token= and
// renders a compact KPI strip from the curated snapshot. Framing is controlled
// by the /embed.html CSP frame-ancestors directive in nginx.conf.
(function () {
  function fmt(n) { return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }); }
  function cell(label, val, unit) { return '<div class="embed-cell"><div class="embed-label">' + label + '</div><div class="embed-value">' + val + (unit ? ' ' + unit : '') + '</div></div>'; }
  var el = document.getElementById('embedKpis');
  var foot = document.getElementById('embedFoot');
  var token = new URLSearchParams(location.search).get('token');
  if (!token) { el.innerHTML = '<div class="error-box">Нет токена</div>'; return; }
  fetch('/api/embed/summary?token=' + encodeURIComponent(token))
    .then(function (r) {
      if (r.status === 401) throw new Error('Токен недействителен');
      if (!r.ok) throw new Error('Ошибка ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var k = d.kpis || {};
      el.innerHTML = cell('Выручка', fmt(k.revenue), '₽') + cell('Чеки', fmt(k.orders), '') +
        cell('Ср. чек', fmt(k.avgCheck), '₽') + cell('Гости', fmt(k.guests), '');
      foot.textContent = d.updatedAt ? new Date(d.updatedAt).toLocaleString('ru-RU') : '';
    })
    .catch(function (e) { el.innerHTML = '<div class="error-box">' + e.message + '</div>'; });
})();
