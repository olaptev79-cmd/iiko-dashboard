
let chartCategories = null, chartAbc = null, currentDays = 30;

async function loadMenu(days, btn) {
  currentDays = days;
  document.querySelectorAll('#appScreen .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('menuTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/menu-analysis?days=' + days);
    document.getElementById('kpiMenuRevenue').textContent = fmt(d.totalRevenue);
    document.getElementById('kpiAbcA').textContent = d.abcSummary.A;
    document.getElementById('kpiAbcB').textContent = d.abcSummary.B;
    document.getElementById('kpiAbcC').textContent = d.abcSummary.C;

    renderCategoryChart(d.categories);
    renderAbcChart(d.abcSummary);

    if (!d.dishes.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>#</th><th>Блюдо</th><th>Категория</th><th>Кол-во</th><th>Сумма, ₽</th><th>Доля</th><th>ABC</th></tr></thead><tbody>' +
      d.dishes.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.category || '—')}</td><td>${fmt(r.amount)}</td><td>${fmt(r.revenue)}</td><td>${r.share}%</td><td><span class="badge badge-${esc(String(r.abc).toLowerCase())}">${esc(r.abc)}</span></td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

let _lastCategories = null, _lastAbc = null;
function renderCategoryChart(categories) {
  _lastCategories = categories;
  const t = chartTheme();
  const ctx = document.getElementById('chartCategories').getContext('2d');
  if (chartCategories) chartCategories.destroy();
  const top = categories.slice(0, 10);
  chartCategories = new Chart(ctx, {
    type: 'bar',
    data: { labels: top.map(c => c.name), datasets: [{ label: 'Выручка, ₽', data: top.map(c => c.revenue), backgroundColor: t.accent, borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: t.text }, grid: { color: t.grid } }, y: { ticks: { color: t.legend }, grid: { display: false } } } },
  });
}

function renderAbcChart(abc) {
  _lastAbc = abc;
  const t = chartTheme();
  const ctx = document.getElementById('chartAbc').getContext('2d');
  if (chartAbc) chartAbc.destroy();
  chartAbc = new Chart(ctx, {
    type: 'doughnut',
    data: {
      // A/B/C — осмысленная шкала «хорошо → плохо», поэтому цвета семантические
      // (success/warning/risk), а не из категориальной последовательности.
      labels: ['A — основная выручка', 'B — стабильные', 'C — кандидаты на исключение'],
      datasets: [{ data: [abc.A, abc.B, abc.C], backgroundColor: [getComputedStyle(document.documentElement).getPropertyValue('--success').trim() || '#8fbb4a', t.accent, t.risk] }],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: t.legend, font: { size: 11 } } } } },
  });
}

onThemeChangeRedrawCharts(() => {
  if (_lastCategories) renderCategoryChart(_lastCategories);
  if (_lastAbc) renderAbcChart(_lastAbc);
});

function exportCsv() {
  downloadCsv('/api/export/top-dishes.csv?days=' + currentDays, `top-dishes-${currentDays}d.csv`);
}

function startPage() {
  loadMenu(30);
}

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadMenu(parseInt(btn.dataset.days, 10), btn);
  });
});

var exportBtn = document.getElementById('exportCsvBtn');
if (exportBtn) exportBtn.addEventListener('click', exportCsv);
