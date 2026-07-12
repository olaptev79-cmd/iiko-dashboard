// Wave 5: speculative, module-dependent reports. Each renders real data if the
// iiko module/field exists, otherwise a clear "requires module X" message.

function unavailable(d) {
  const mod = d.requiresModule ? ' (нужен: ' + esc(d.requiresModule) + ')' : '';
  return '<div class="unavailable-box">Недоступно на этом сервере iiko' + mod + '. ' + esc(d.error || '') + '</div>';
}

async function loadTips() {
  const el = document.getElementById('tipsContainer');
  try {
    const d = await api('/api/tips?days=30');
    if (!d.available) { el.innerHTML = unavailable(d); return; }
    if (!d.waiters.length) { el.innerHTML = '<div class="empty-box">Чаевых за период нет</div>'; return; }
    el.innerHTML = '<div style="margin-bottom:12px;font-size:14px;">Всего чаевых: <strong>' + fmt(d.total) + ' ₽</strong></div>' +
      '<table><thead><tr><th>Официант</th><th>Чаевые, ₽</th></tr></thead><tbody>' +
      d.waiters.map((w) => `<tr><td>${esc(w.name)}</td><td>${fmt(w.tips)}</td></tr>`).join('') + '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

async function loadGuestType() {
  const el = document.getElementById('guestTypeContainer');
  try {
    const d = await api('/api/avg-check-by-guest-type?days=30');
    if (!d.available) { el.innerHTML = unavailable(d); return; }
    if (!d.types.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Тип гостя</th><th>Выручка, ₽</th><th>Средний чек, ₽</th></tr></thead><tbody>' +
      d.types.map((t) => `<tr><td>${esc(t.name)}</td><td>${fmt(t.revenue)}</td><td>${fmt(t.avgCheck)}</td></tr>`).join('') + '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

async function loadSegmentation() {
  const el = document.getElementById('segmentationContainer');
  try {
    const d = await api('/api/guest-segmentation?days=30');
    if (!d.available) { el.innerHTML = unavailable(d); return; }
    el.innerHTML = '<div class="yoy-row">' +
      `<div class="yoy-tile"><div class="yoy-label">Всего гостей</div><div class="yoy-value">${fmt(d.totalGuests)}</div></div>` +
      `<div class="yoy-tile"><div class="yoy-label">Новые</div><div class="yoy-value">${fmt(d.newGuests)}</div></div>` +
      `<div class="yoy-tile"><div class="yoy-label">Постоянные</div><div class="yoy-value">${fmt(d.returning)}</div><div class="delta up">${d.returnRate}%</div></div>` +
      '</div>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

async function loadDocuments() {
  const el = document.getElementById('documentsContainer');
  try {
    const d = await api('/api/document-reminders');
    if (!d.available) { el.innerHTML = unavailable(d); return; }
    if (!d.reminders.length) { el.innerHTML = '<div class="empty-box">Ближайших сроков документов нет</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Сотрудник</th><th>Истекает</th></tr></thead><tbody>' +
      d.reminders.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(String(r.expires).slice(0, 10))}</td></tr>`).join('') + '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

async function loadExpiry() {
  const el = document.getElementById('expiryContainer');
  try {
    const d = await api('/api/expiring-products');
    if (!d.available) { el.innerHTML = unavailable(d); return; }
    if (!d.items.length) { el.innerHTML = '<div class="empty-box">Товаров с истекающим сроком нет</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Товар</th><th>Годен до</th></tr></thead><tbody>' +
      d.items.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(String(r.expires).slice(0, 10))}</td></tr>`).join('') + '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadTips();
  loadGuestType();
  loadSegmentation();
  loadDocuments();
  loadExpiry();
}
