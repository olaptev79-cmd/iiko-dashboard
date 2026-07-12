// Standalone public read-only KPI view (#38). No auth, no nav — reads a scoped
// token from ?token= and shows only the curated snapshot the backend exposes.
(function () {
  function fmt(n) { return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }); }
  function tile(label, val, unit) { return '<div class="kpi"><div class="label">' + label + '</div><div class="value">' + val + (unit ? ' ' + unit : '') + '</div></div>'; }
  var el = document.getElementById('publicKpis');
  var foot = document.getElementById('publicFoot');
  var token = new URLSearchParams(location.search).get('token');
  if (!token) { el.innerHTML = '<div class="error-box">В ссылке нет токена доступа</div>'; return; }
  fetch('/api/public/summary?token=' + encodeURIComponent(token))
    .then(function (r) {
      if (r.status === 401) throw new Error('Ссылка недействительна, отозвана или истекла');
      if (!r.ok) throw new Error('Ошибка загрузки (' + r.status + ')');
      return r.json();
    })
    .then(function (d) {
      var k = d.kpis || {};
      el.innerHTML = tile('Выручка', fmt(k.revenue), '₽') + tile('Чеки', fmt(k.orders), '') +
        tile('Средний чек', fmt(k.avgCheck), '₽') + tile('Гости', fmt(k.guests), '');
      foot.textContent = 'Обновлено: ' + (d.updatedAt ? new Date(d.updatedAt).toLocaleString('ru-RU') : '—');
    })
    .catch(function (e) { el.innerHTML = '<div class="error-box">' + e.message + '</div>'; });
})();
