
let chartTrend = null, chartWeekday = null, chartHourly = null, chartAvgTrend = null;

let _lastSalesDays = 30;
async function loadChart(days, btn) {
  document.querySelectorAll('.period-btn[data-days]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _lastSalesDays = days;
  try {
    const d = await api('/api/chart?days=' + days);
    const t = chartTheme();
    const ctx = document.getElementById('chartTrend').getContext('2d');
    if (chartTrend) chartTrend.destroy();
    chartTrend = new Chart(ctx, {
      data: {
        labels: d.labels,
        datasets: [
          { type: 'bar', label: 'Выручка, ₽', data: d.revenue, backgroundColor: t.accent, borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Чеки', data: d.orders, borderColor: t.risk, backgroundColor: t.risk, tension: 0.3, yAxisID: 'y1', pointRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: t.legend } } },
        scales: {
          x: { ticks: { color: t.text }, grid: { display: false } },
          y: { position: 'left', ticks: { color: t.text }, grid: { color: t.grid } },
          y1: { position: 'right', ticks: { color: t.text }, grid: { display: false } },
        },
      },
    });
  } catch (e) { console.error(e); }
}

async function loadWeekday() {
  try {
    const d = await api('/api/weekday-breakdown?days=30');
    const t = chartTheme();
    const ctx = document.getElementById('chartWeekday').getContext('2d');
    if (chartWeekday) chartWeekday.destroy();
    chartWeekday = new Chart(ctx, {
      type: 'bar',
      data: { labels: d.labels, datasets: [{ label: 'Средняя выручка, ₽', data: d.avgRevenuePerDay, backgroundColor: t.series[2], borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: t.text }, grid: { display: false } }, y: { ticks: { color: t.text }, grid: { color: t.grid } } } },
    });
  } catch (e) { console.error(e); }
}

async function loadHourly() {
  const container = document.getElementById('hourlyContainer');
  try {
    const d = await api('/api/hourly-activity?days=7');
    if (!d.available) {
      container.innerHTML = '<div class="unavailable-box">Почасовая аналитика недоступна на этом сервере iiko: ' + esc(d.error || 'нет поля HourOpen') + '</div>';
      return;
    }
    const hours = d.hours.filter(h => h.revenue > 0 || h.orders > 0);
    if (!hours.length) { container.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    const t = chartTheme();
    const ctx = document.getElementById('chartHourly').getContext('2d');
    if (chartHourly) chartHourly.destroy();
    chartHourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.hours.map(h => h.hour + ':00'),
        datasets: [{ label: 'Выручка, ₽', data: d.hours.map(h => h.revenue), backgroundColor: t.risk, borderRadius: 4 }],
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: t.text, maxRotation: 0 }, grid: { display: false } }, y: { ticks: { color: t.text }, grid: { color: t.grid } } } },
    });
  } catch (e) {
    container.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

// ---- Средний чек: динамика по дням (#10) ----
let _lastAvgDays = 30;
async function loadAvgTrend(days, btn) {
  document.querySelectorAll('.period-btn[data-avgdays]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else { const def = document.querySelector('.period-btn[data-avgdays="' + days + '"]'); if (def) def.classList.add('active'); }
  _lastAvgDays = days;
  try {
    const d = await api('/api/average-check-trend?days=' + days);
    const hint = document.getElementById('avgTrendHint');
    if (hint) hint.textContent = 'средний чек по дням · в среднем ' + fmt(d.overallAvg) + ' ₽';
    const t = chartTheme();
    const ctx = document.getElementById('chartAvgTrend').getContext('2d');
    if (chartAvgTrend) chartAvgTrend.destroy();
    chartAvgTrend = new Chart(ctx, {
      type: 'line',
      data: { labels: d.labels, datasets: [{ label: 'Средний чек, ₽', data: d.avgCheck, borderColor: t.accent, backgroundColor: t.accent, tension: 0.3, pointRadius: 2, fill: false }] },
      options: { responsive: true, plugins: { legend: { labels: { color: t.legend } } }, scales: { x: { ticks: { color: t.text }, grid: { display: false } }, y: { ticks: { color: t.text }, grid: { color: t.grid } } } },
    });
  } catch (e) { console.error(e); }
}

// ---- Год к году (#9/#48) ----
function yoyTile(label, cur, prev, pct, unit) {
  const u = unit ? ' ' + unit : '';
  return '<div class="yoy-tile">' +
    '<div class="yoy-label">' + esc(label) + '</div>' +
    '<div class="yoy-value">' + fmt(cur) + u + '</div>' +
    '<div class="yoy-prev">год назад: ' + fmt(prev) + u + '</div>' +
    '<div class="delta ' + deltaClass(pct) + '">' + deltaArrow(pct) + ' ' + fmtPct(pct) + '</div>' +
  '</div>';
}
async function loadYoY() {
  const el = document.getElementById('yoyContainer');
  try {
    const d = await api('/api/year-over-year?days=30');
    el.innerHTML = '<div class="yoy-row">' +
      yoyTile('Выручка', d.current.revenue, d.lastYear.revenue, d.revenueChangePct, '₽') +
      yoyTile('Чеки', d.current.orders, d.lastYear.orders, d.ordersChangePct, '') +
    '</div>';
  } catch (e) {
    el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

// ---- План / факт за произвольный период (#1) ----
async function runPlanFact() {
  const from = document.getElementById('pfFrom').value;
  const to = document.getElementById('pfTo').value;
  const plan = document.getElementById('pfPlan').value;
  const out = document.getElementById('planFactResult');
  if (!from || !to) { out.innerHTML = '<div class="error-box">Укажите обе даты периода</div>'; return; }
  out.innerHTML = '<div class="loading">Расчёт...</div>';
  try {
    const d = await api('/api/plan-fact?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&plan=' + encodeURIComponent(plan || 0));
    let html = '<div class="pf-fact">Факт: <strong>' + fmt(d.fact) + ' ₽</strong> · чеков: ' + fmt(d.orders) + '</div>';
    if (d.plan > 0) {
      const pct = d.completionPct || 0;
      const barCls = pct >= 100 ? 'up' : pct >= 80 ? 'flat' : 'down';
      html += '<div class="pf-plan">План: ' + fmt(d.plan) + ' ₽ · выполнение <span class="delta ' + barCls + '">' + pct.toFixed(1) + '%</span></div>' +
        '<div class="pf-bar"><div class="pf-bar-fill ' + barCls + '" style="width:' + Math.min(100, pct) + '%;"></div></div>' +
        (d.remaining > 0 ? '<div class="pf-remaining">Осталось до плана: ' + fmt(d.remaining) + ' ₽</div>'
                         : '<div class="pf-remaining">План перевыполнен на ' + fmt(-d.remaining) + ' ₽</div>');
    } else {
      html += '<div class="pf-remaining">Введите план выручки, чтобы увидеть процент выполнения.</div>';
    }
    out.innerHTML = html;
  } catch (e) {
    out.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

// ---- Эффективность по сменам (#16) ----
async function loadShiftEfficiency() {
  const el = document.getElementById('shiftEfficiency');
  try {
    const d = await api('/api/shift-efficiency?days=30');
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет почасовых данных') + '</div>'; return; }
    const maxRev = Math.max(1, ...d.shifts.map(s => s.revenue));
    el.innerHTML = '<table><thead><tr><th>Смена</th><th>Выручка, ₽</th><th>Чеки</th><th>Средний чек, ₽</th><th></th></tr></thead><tbody>' +
      d.shifts.map(s => `<tr><td>${esc(s.label)}</td><td>${fmt(s.revenue)}</td><td>${fmt(s.orders)}</td><td>${fmt(s.avgCheck)}</td>` +
        `<td style="width:120px;"><div class="pf-bar"><div class="pf-bar-fill" style="width:${Math.round(s.revenue / maxRev * 100)}%;"></div></div></td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// ---- #28 Упрощённый P&L ----
async function loadPnl() {
  const el = document.getElementById('pnlContainer');
  try {
    const d = await api('/api/pnl?days=30');
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет данных') + '</div>'; return; }
    let html = '<div class="yoy-row">' +
      `<div class="yoy-tile"><div class="yoy-label">Выручка</div><div class="yoy-value">${fmt(d.revenue)} ₽</div></div>`;
    if (d.cogsAvailable) {
      html += `<div class="yoy-tile"><div class="yoy-label">Себестоимость (списания)</div><div class="yoy-value">${fmt(d.cogs)} ₽</div></div>` +
        `<div class="yoy-tile"><div class="yoy-label">Валовая прибыль</div><div class="yoy-value">${fmt(d.grossProfit)} ₽</div><div class="delta ${d.grossMarginPct >= 0 ? 'up' : 'down'}">${d.grossMarginPct}%</div></div>`;
    } else {
      html += `<div class="yoy-tile"><div class="yoy-label">Себестоимость</div><div class="yoy-value">н/д</div><div class="yoy-prev">склад недоступен</div></div>`;
    }
    html += '</div><div class="pf-remaining" style="margin-top:12px;">' + esc(d.note) + '</div>';
    el.innerHTML = html;
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadChart(30);
  loadWeekday();
  loadHourly();
  loadAvgTrend(30);
  loadYoY();
  loadShiftEfficiency();
  loadPnl();
  // Предзаполняем период план/факта последними 30 днями.
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  const iso = (dt) => dt.toISOString().slice(0, 10);
  document.getElementById('pfFrom').value = iso(from);
  document.getElementById('pfTo').value = iso(to);
}

onThemeChangeRedrawCharts(() => {
  loadChart(_lastSalesDays);
  loadWeekday();
  loadHourly();
  loadAvgTrend(_lastAvgDays);
});

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadChart(parseInt(btn.dataset.days, 10), btn);
  });
});
document.querySelectorAll('.period-btn[data-avgdays]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadAvgTrend(parseInt(btn.dataset.avgdays, 10), btn);
  });
});
document.getElementById('pfBtn').addEventListener('click', runPlanFact);
