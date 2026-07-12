
let chartRev = null, chartDept = null;

async function loadSummary() {
  try {
    const d = await api('/api/dashboard');
    document.getElementById('kpiRevenue').textContent = fmt(d.revenue);
    document.getElementById('kpiOrders').textContent = fmt(d.orders);
    document.getElementById('kpiAvg').textContent = fmt(d.avgCheck);
    document.getElementById('kpiGuests').textContent = fmt(d.guests || 0);
    const guestsSub = document.getElementById('kpiGuestsSub');
    if (guestsSub) guestsSub.textContent = d.guestsSource === 'live' ? 'человек' : 'человек, оценка';
    if (d.comparedToYesterday) {
      const c = d.comparedToYesterday;
      setDelta('kpiRevenueDelta', c.revenueChangePct, 'к вчера');
      setDelta('kpiOrdersDelta', c.ordersChangePct, 'к вчера');
      setDelta('kpiAvgDelta', c.avgCheckChangePct, 'к вчера');
    }
    if (d.byDepartment && d.byDepartment.length) renderDeptChart(d.byDepartment);
  } catch (e) { console.error(e); }
}

function setDelta(id, pct, suffix) {
  const el = document.getElementById(id);
  if (!el) return;
  const cls = deltaClass(pct);
  el.className = 'delta ' + cls;
  el.textContent = deltaArrow(pct) + ' ' + fmtPct(pct) + ' ' + suffix;
}

async function loadForecast() {
  try {
    const d = await api('/api/forecast');
    document.getElementById('kpiForecast').textContent = fmt(d.forecastRevenue || 0);
    document.getElementById('kpiPlan').textContent = (d.planCompletion || 0);
  } catch (e) { console.error(e); }
}

async function loadAverageCheck() {
  try {
    const d = await api('/api/average-check');
    document.getElementById('kpiAvgWeek').textContent = fmt(d.week.avgCheck);
    setDelta('kpiAvgWeekDelta', d.week.changePct, 'к пред. неделе');
    document.getElementById('kpiAvgMonth').textContent = fmt(d.month.avgCheck);
    setDelta('kpiAvgMonthDelta', d.month.changePct, 'к пред. месяцу');
  } catch (e) { console.error(e); }
}

let _lastChartDays = 7, _lastDeptData = null;
async function loadChart(days, btn) {
  document.querySelectorAll('#appScreen .charts-grid .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _lastChartDays = days;
  try {
    const d = await api('/api/chart?days=' + days);
    const t = chartTheme();
    const ctx = document.getElementById('chartRevenue').getContext('2d');
    if (chartRev) chartRev.destroy();
    chartRev = new Chart(ctx, {
      type: 'bar',
      data: { labels: d.labels, datasets: [{ label: 'Выручка', data: d.revenue, backgroundColor: t.accent, borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: t.text }, grid: { display: false } }, y: { ticks: { color: t.text }, grid: { color: t.grid } } } },
    });
  } catch (e) { console.error(e); }
}

function renderDeptChart(data) {
  _lastDeptData = data;
  const t = chartTheme();
  const ctx = document.getElementById('chartDepts').getContext('2d');
  if (chartDept) chartDept.destroy();
  chartDept = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: data.map(d => d.name), datasets: [{ data: data.map(d => d.revenue), backgroundColor: t.series }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: t.legend, font: { size: 11 } } } } },
  });
}

onThemeChangeRedrawCharts(() => {
  loadChart(_lastChartDays);
  if (_lastDeptData) renderDeptChart(_lastDeptData);
});

async function loadDishes() {
  const el = document.getElementById('dishesTable');
  try {
    const d = await api('/api/top-dishes?days=1');
    if (!d.dishes.length) { el.innerHTML = '<div class="empty-box">Нет продаж сегодня</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>#</th><th>Блюдо</th><th>Категория</th><th>Кол-во</th><th>Сумма, ₽</th></tr></thead><tbody>' +
      d.dishes.slice(0, 10).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.category || '—')}</td><td>${fmt(r.amount)}</td><td>${fmt(r.revenue)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

async function loadBranches() {
  const el = document.getElementById('branchesContainer');
  try {
    const d = await api('/api/branches?days=30');
    if (!d.branches.length) { el.innerHTML = '<div class="empty-box">Нет данных</div>'; return; }
    el.innerHTML = d.branches.slice(0, 10).map(b => {
      const cls = deltaClass(b.changePct);
      return `<div class="branch-item"><div class="branch-name">${esc(b.name)}</div><div class="branch-rev">${fmt(b.revenue)} ₽</div><div class="branch-change ${cls}">${deltaArrow(b.changePct)} ${fmtPct(b.changePct)}</div></div>`;
    }).join('');
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadSummary(); loadForecast(); loadAverageCheck(); loadChart(7); loadDishes(); loadBranches();
  pollTimers.push(setInterval(loadSummary, 60000));
  // #42/#43: make the KPI tiles a personalisable board (drag + pin, persisted)
  initWidgetBoard(document.getElementById('kpiGrid'), 'index_kpi');
}

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadChart(parseInt(btn.dataset.days, 10), btn);
  });
});
