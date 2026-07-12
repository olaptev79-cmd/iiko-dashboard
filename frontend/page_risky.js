
// Human-readable labels + badge severity per event type (badge-c = наиболее
// критично, badge-b = требует внимания). Keys must match dashboardService's
// getRiskyOperations() `type` values.
const RISKY_TYPES = {
  deleted_dish: { label: 'Удаление со списанием', badge: 'badge-c' },
  order_deleted: { label: 'Аннулирование чека', badge: 'badge-c' },
  refund: { label: 'Возврат после оплаты', badge: 'badge-c' },
  big_discount: { label: 'Крупная скидка', badge: 'badge-b' },
  payment_removed: { label: 'Удалена оплата (доставка)', badge: 'badge-b' },
};

let riskyData = null;
let activeFilter = 'all';

function riskyBadge(type) {
  const meta = RISKY_TYPES[type] || { label: type, badge: 'badge-b' };
  return `<span class="badge ${meta.badge}">${esc(meta.label)}</span>`;
}

function renderFilters() {
  const el = document.getElementById('riskyFilters');
  if (!el || !riskyData) return;
  const counts = riskyData.totals || {};
  const items = [
    { key: 'all', label: 'Все', count: counts.events || 0 },
    { key: 'deleted_dish', label: 'Удаления', count: counts.deletedDish || 0 },
    { key: 'order_deleted', label: 'Аннулирования', count: counts.orderDeleted || 0 },
    { key: 'refund', label: 'Возвраты', count: counts.refund || 0 },
    { key: 'big_discount', label: 'Скидки', count: counts.bigDiscount || 0 },
    { key: 'payment_removed', label: 'Оплата удалена', count: counts.paymentRemoved || 0 },
  ];
  el.innerHTML = items.map(i =>
    `<button class="period-btn risky-filter-btn${i.key === activeFilter ? ' active' : ''}" data-filter="${i.key}">${esc(i.label)} (${i.count})</button>`
  ).join('');
  el.querySelectorAll('.risky-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderFilters();
      renderTimeline();
    });
  });
}

function renderTimeline() {
  const el = document.getElementById('eventsTimeline');
  if (!el || !riskyData) return;
  const events = activeFilter === 'all'
    ? riskyData.events
    : riskyData.events.filter(e => e.type === activeFilter);

  if (!events.length) {
    el.innerHTML = '<div class="empty-box">Нет событий за выбранный период/фильтр</div>';
    return;
  }

  el.innerHTML = '<table><thead><tr><th>Дата</th><th>Час</th><th>Сотрудник</th><th>Тип</th><th>Блюдо/чек</th><th>Сумма, ₽</th></tr></thead><tbody>' +
    events.slice(0, 200).map(e => `<tr>
      <td>${esc(e.date || '—')}</td>
      <td>${e.hour != null ? esc(e.hour) + ':00' : '—'}</td>
      <td>${esc(e.employee)}</td>
      <td>${riskyBadge(e.type)}</td>
      <td>${esc(e.dish || '—')}${e.discountName ? ' · ' + esc(e.discountName) : ''}</td>
      <td>${fmt(e.discountSum || e.sum)}</td>
    </tr>`).join('') +
    '</tbody></table>';
}

function renderEmployeeTable() {
  const el = document.getElementById('employeeTable');
  if (!el || !riskyData) return;
  if (!riskyData.byEmployee.length) {
    el.innerHTML = '<div class="empty-box">Нет данных</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Сотрудник</th><th>Событий</th><th>Сумма, ₽</th></tr></thead><tbody>' +
    riskyData.byEmployee.slice(0, 20).map(e =>
      `<tr><td>${esc(e.name)}</td><td>${fmt(e.total)}</td><td>${fmt(e.sum)}</td></tr>`
    ).join('') +
    '</tbody></table>';
}

function renderTypesBreakdown() {
  const el = document.getElementById('typesBreakdown');
  if (!el || !riskyData) return;
  const t = riskyData.totals || {};
  const rows = [
    { key: 'deleted_dish', count: t.deletedDish || 0 },
    { key: 'order_deleted', count: t.orderDeleted || 0 },
    { key: 'refund', count: t.refund || 0 },
    { key: 'big_discount', count: t.bigDiscount || 0 },
    { key: 'payment_removed', count: t.paymentRemoved || 0 },
  ].filter(r => r.count > 0);

  if (!rows.length) {
    el.innerHTML = '<div class="empty-box">Опасных операций не обнаружено</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Тип</th><th>Кол-во</th></tr></thead><tbody>' +
    rows.map(r => `<tr><td>${riskyBadge(r.key)}</td><td>${fmt(r.count)}</td></tr>`).join('') +
    '</tbody></table>';
}

async function loadRisky(days, btn) {
  document.querySelectorAll('#appScreen .period-btns .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadCancellationReasons(days);

  const unavailableEl = document.getElementById('riskyUnavailable');
  const contentEl = document.getElementById('riskyContent');
  const timelineCard = document.getElementById('riskyTimelineCard');
  unavailableEl.innerHTML = '';

  try {
    const d = await api('/api/risky-operations?days=' + days);
    riskyData = d;
    activeFilter = 'all';

    if (!d.available) {
      contentEl.style.display = 'none';
      timelineCard.style.display = 'none';
      unavailableEl.innerHTML = '<div class="unavailable-box">Отчёт об опасных операциях недоступен на этом сервере iiko: ' + esc(d.error || 'нет доступа к нужным полям отчёта') + '</div>';
      ['kpiEvents', 'kpiDeletedDish', 'kpiOrderDeleted', 'kpiRefund', 'kpiBigDiscount'].forEach(id => {
        document.getElementById(id).textContent = '—';
      });
      document.getElementById('kpiDiscountSum').textContent = '0';
      return;
    }

    contentEl.style.display = '';
    timelineCard.style.display = '';

    const t = d.totals || {};
    document.getElementById('kpiEvents').textContent = fmt(t.events);
    document.getElementById('kpiDeletedDish').textContent = fmt(t.deletedDish);
    document.getElementById('kpiOrderDeleted').textContent = fmt(t.orderDeleted);
    document.getElementById('kpiRefund').textContent = fmt(t.refund);
    document.getElementById('kpiBigDiscount').textContent = fmt(t.bigDiscount);
    document.getElementById('kpiDiscountSum').textContent = fmt(t.discountSum);

    renderFilters();
    renderEmployeeTable();
    renderTypesBreakdown();
    renderTimeline();
  } catch (e) {
    contentEl.style.display = 'none';
    timelineCard.style.display = 'none';
    unavailableEl.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

// ---- Причины списаний блюд (#8) ----
async function loadCancellationReasons(days) {
  const el = document.getElementById('cancelReasonsTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/cancellation-reasons?days=' + days);
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет данных на этом сервере iiko') + '</div>'; return; }
    if (!d.reasons.length) { el.innerHTML = '<div class="empty-box">Списаний за период нет</div>'; return; }
    let head = '<div style="margin-bottom:14px;font-size:14px;color:var(--text);">Всего списаний: <strong>' + fmt(d.totalCount) + '</strong> на сумму <strong>' + fmt(d.totalSum) + ' ₽</strong>';
    if (!d.hasReasonField) head += ' <span class="hint">(сервер iiko не отдаёт причину — сгруппировано в одну строку)</span>';
    head += '</div>';
    el.innerHTML = head + '<table><thead><tr><th>Причина</th><th>Кол-во</th><th>Сумма, ₽</th></tr></thead><tbody>' +
      d.reasons.map(r => `<tr><td>${esc(r.reason)}</td><td>${fmt(r.count)}</td><td>${fmt(r.sum)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadRisky(30);
}

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadRisky(parseInt(btn.dataset.days, 10), btn);
  });
});
