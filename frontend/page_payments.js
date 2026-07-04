
let chartPayments = null, chartOrderTypes = null;

async function loadPayments(days, btn) {
  document.querySelectorAll('#appScreen .period-btns .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const chartContainer = document.getElementById('payChartContainer');
  const tableEl = document.getElementById('paymentsTable');
  try {
    const d = await api('/api/payments?days=' + days);
    if (!d.available) {
      chartContainer.innerHTML = '<div class="unavailable-box">Разбивка по типам оплаты недоступна на этом сервере iiko: ' + esc(d.error || 'нет поля PayTypes') + '</div>';
      tableEl.innerHTML = '<div class="unavailable-box">Нет данных</div>';
      document.getElementById('kpiPayRevenue').textContent = '—';
      document.getElementById('kpiDiscount').textContent = '—';
      document.getElementById('kpiPayTypesCount').textContent = '—';
      return;
    }
    document.getElementById('kpiPayRevenue').textContent = fmt(d.totalRevenue);
    document.getElementById('kpiDiscount').textContent = fmt(d.totalDiscount);
    document.getElementById('kpiPayTypesCount').textContent = d.payTypes.length;

    if (!d.payTypes.length) {
      chartContainer.innerHTML = '<div class="empty-box">Нет данных за период</div>';
      tableEl.innerHTML = '<div class="empty-box">Нет данных</div>';
      return;
    }
    if (!document.getElementById('chartPayments')) {
      chartContainer.innerHTML = '<canvas id="chartPayments" height="220"></canvas>';
    }
    const ctx = document.getElementById('chartPayments').getContext('2d');
    if (chartPayments) chartPayments.destroy();
    chartPayments = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: d.payTypes.map(p => p.name), datasets: [{ data: d.payTypes.map(p => p.revenue), backgroundColor: ['#4f98a3','#a84b2f','#1b474d','#bce2e7','#944454','#ffc553','#848456','#6e522b'] }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#cdccca', font: { size: 11 } } } } },
    });

    tableEl.innerHTML = '<table><thead><tr><th>Тип оплаты</th><th>Выручка, ₽</th><th>Кол-во</th><th>Доля</th></tr></thead><tbody>' +
      d.payTypes.map(p => `<tr><td>${esc(p.name)}</td><td>${fmt(p.revenue)}</td><td>${fmt(p.amount)}</td><td>${p.share}%</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) {
    chartContainer.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
    tableEl.innerHTML = '';
  }
}

async function loadOrderTypes(days = 30) {
  const el = document.getElementById('orderTypesContainer');
  try {
    const d = await api('/api/order-types?days=' + days);
    if (!d.available) {
      el.innerHTML = '<div class="unavailable-box">Типы заказов недоступны на этом сервере iiko: ' + esc(d.error || 'нет поля OrderType') + '</div>';
      return;
    }
    if (!d.types.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Тип заказа</th><th>Выручка, ₽</th><th>Кол-во</th></tr></thead><tbody>' +
      d.types.map(t => `<tr><td>${esc(t.name)}</td><td>${fmt(t.revenue)}</td><td>${fmt(t.orders)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadPayments(30);
  loadOrderTypes(30);
}

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadPayments(parseInt(btn.dataset.days, 10), btn);
  });
});
