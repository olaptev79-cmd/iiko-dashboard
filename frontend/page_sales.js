
let chartTrend = null, chartWeekday = null, chartHourly = null;

let _lastSalesDays = 30;
async function loadChart(days, btn) {
  document.querySelectorAll('#appScreen .card .period-btn').forEach(b => b.classList.remove('active'));
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

function startPage() {
  loadChart(30);
  loadWeekday();
  loadHourly();
}

onThemeChangeRedrawCharts(() => {
  loadChart(_lastSalesDays);
  loadWeekday();
  loadHourly();
});

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadChart(parseInt(btn.dataset.days, 10), btn);
  });
});
