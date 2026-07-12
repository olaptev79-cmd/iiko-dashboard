let chartGuests = null;
let lastGuestsData = null;

function renderGuestsTrend(data) {
  const t = chartTheme();
  const ctx = document.getElementById('chartGuests').getContext('2d');
  if (chartGuests) chartGuests.destroy();
  chartGuests = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.trend.labels,
      datasets: [{ label: 'Гости', data: data.trend.guests, backgroundColor: t.accent, borderRadius: 4 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: t.text }, grid: { display: false } },
        y: { ticks: { color: t.text }, grid: { color: t.grid } },
      },
    },
  });
}

async function loadGuests() {
  const unavailableEl = document.getElementById('guestsUnavailable');
  const contentEl = document.getElementById('guestsContent');
  unavailableEl.innerHTML = '';
  try {
    const d = await api('/api/guests');
    if (!d.available) {
      contentEl.classList.add('hidden');
      unavailableEl.innerHTML = '<div class="unavailable-box">Аналитика гостей недоступна: ' + esc(d.error || 'сервер iiko не предоставляет поле числа гостей') + '</div>';
      return;
    }
    contentEl.classList.remove('hidden');
    lastGuestsData = d;
    document.getElementById('kpiGuestsToday').textContent = fmt(d.today.total);
    document.getElementById('kpiGuestsWeek').textContent = fmt(d.week.total);
    document.getElementById('kpiGuestsWeekAvg').textContent = 'в среднем ' + fmt(d.week.avgPerDay) + ' в день';
    document.getElementById('kpiGuestsMonth').textContent = fmt(d.month.total);
    document.getElementById('kpiGuestsMonthAvg').textContent = 'в среднем ' + fmt(d.month.avgPerDay) + ' в день';
    renderGuestsTrend(d);
  } catch (e) {
    contentEl.classList.add('hidden');
    unavailableEl.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

async function loadCustomGuestsRange() {
  const range = readDateRange('guestsFrom', 'guestsTo');
  const el = document.getElementById('guestsCustomResult');
  if (!range) { toast('Проверьте даты периода — начало должно быть раньше окончания', 'error'); return; }
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/guests?customFrom=' + encodeURIComponent(range.from) + '&customTo=' + encodeURIComponent(range.to));
    if (!d.available || !d.custom) {
      el.innerHTML = '<div class="unavailable-box">Нет данных за выбранный период</div>';
      return;
    }
    el.innerHTML = '<div class="kpi-grid"><div class="kpi"><div class="label">Гости за период</div><div class="value">' + fmt(d.custom.total) + '</div><div class="sub">в среднем ' + fmt(d.custom.avgPerDay) + ' в день</div></div></div>';
  } catch (e) {
    el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

document.getElementById('guestsApplyBtn').addEventListener('click', loadCustomGuestsRange);

onThemeChangeRedrawCharts(() => { if (lastGuestsData) renderGuestsTrend(lastGuestsData); });

function startPage() {
  loadGuests();
}
