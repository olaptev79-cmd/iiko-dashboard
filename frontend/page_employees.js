
let chartPerf = null;

async function loadPerformance(days, btn) {
  document.querySelectorAll('#appScreen .period-btns .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('perfContainer');
  try {
    const d = await api('/api/employees/performance?days=' + days);
    if (!d.available) {
      el.innerHTML = '<div class="unavailable-box">Продажи по сотрудникам недоступны на этом сервере iiko: ' + esc(d.error || 'нет полей WaiterName/CashierName') + '</div>';
      return;
    }
    if (!d.employees.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    const top = d.employees.slice(0, 15);
    el.innerHTML = '<canvas id="chartPerf" height="180"></canvas><table style="margin-top:20px;"><thead><tr><th>Сотрудник</th><th>Выручка, ₽</th><th>Чеки</th><th>Средний чек</th></tr></thead><tbody>' +
      top.map(e => `<tr><td>${esc(e.name)}</td><td>${fmt(e.revenue)}</td><td>${fmt(e.orders)}</td><td>${fmt(e.avgCheck)}</td></tr>`).join('') +
      '</tbody></table>';
    const ctx = document.getElementById('chartPerf').getContext('2d');
    if (chartPerf) chartPerf.destroy();
    chartPerf = new Chart(ctx, {
      type: 'bar',
      data: { labels: top.map(e => e.name), datasets: [{ label: 'Выручка, ₽', data: top.map(e => e.revenue), backgroundColor: '#4f98a3', borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#797876' }, grid: { color: '#393836' } }, y: { ticks: { color: '#cdccca' }, grid: { display: false } } } },
    });
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

async function loadDirectory() {
  const el = document.getElementById('directoryContainer');
  try {
    const d = await api('/api/employees/directory');
    if (!d.available) {
      el.innerHTML = '<div class="unavailable-box">Справочник сотрудников недоступен: ' + esc(d.error || 'нет доступа к /resto/api/employees') + '</div>';
      return;
    }
    if (!d.employees.length) { el.innerHTML = '<div class="empty-box">Нет данных</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Имя</th><th>Роль</th><th>Статус</th></tr></thead><tbody>' +
      d.employees.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(e.role)}</td><td>${esc(e.status)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadPerformance(30);
  loadDirectory();
}

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadPerformance(parseInt(btn.dataset.days, 10), btn);
  });
});
