
let chartAccounts = null;

async function loadWarehouse(days, btn) {
  document.querySelectorAll('#appScreen .period-btns .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const chartContainer = document.getElementById('accountsChartContainer');
  const accountsTableEl = document.getElementById('accountsTable');
  const itemsTableEl = document.getElementById('itemsTable');
  try {
    const d = await api('/api/warehouse?days=' + days);
    const warningEl = document.getElementById('warehouseWarning');
    if (warningEl) warningEl.innerHTML = '';
    if (!d.available) {
      chartContainer.innerHTML = '<div class="unavailable-box">Складская аналитика недоступна на этом сервере iiko: ' + esc(d.error || 'нет доступа к отчёту по проводкам') + '</div>';
      accountsTableEl.innerHTML = '<div class="unavailable-box">Нет данных</div>';
      itemsTableEl.innerHTML = '<div class="unavailable-box">Нет данных</div>';
      document.getElementById('kpiWriteoffSum').textContent = '—';
      document.getElementById('kpiCost').textContent = '—';
      document.getElementById('kpiAccountsCount').textContent = '—';
      return;
    }
    document.getElementById('kpiWriteoffSum').textContent = fmt(d.totalWriteoffSum);
    document.getElementById('kpiCost').textContent = fmt(d.totalCost);
    document.getElementById('kpiAccountsCount').textContent = d.accounts.length;

    if (warningEl && d.filteredToWriteoffs === false) {
      warningEl.innerHTML = '<div class="unavailable-box">Сервер iiko не позволяет отфильтровать именно списания — показаны все проводки по складу за период.</div>';
    }

    if (!d.accounts.length) {
      chartContainer.innerHTML = '<div class="empty-box">Нет данных за период</div>';
      accountsTableEl.innerHTML = '<div class="empty-box">Нет данных</div>';
      itemsTableEl.innerHTML = '<div class="empty-box">Нет данных</div>';
      return;
    }
    if (!document.getElementById('chartAccounts')) {
      chartContainer.innerHTML = '<canvas id="chartAccounts" height="220"></canvas>';
    }
    const ctx = document.getElementById('chartAccounts').getContext('2d');
    if (chartAccounts) chartAccounts.destroy();
    const top = d.accounts.slice(0, 8);
    chartAccounts = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: top.map(a => a.name), datasets: [{ data: top.map(a => a.sum), backgroundColor: ['#4f98a3','#a84b2f','#1b474d','#bce2e7','#944454','#ffc553','#848456','#6e522b'] }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#cdccca', font: { size: 11 } } } } },
    });

    accountsTableEl.innerHTML = '<table><thead><tr><th>Счёт</th><th>Сумма, ₽</th><th>Кол-во</th></tr></thead><tbody>' +
      d.accounts.map(a => `<tr><td>${esc(a.name)}</td><td>${fmt(a.sum)}</td><td>${fmt(a.amount)}</td></tr>`).join('') +
      '</tbody></table>';

    itemsTableEl.innerHTML = '<table><thead><tr><th>Позиция</th><th>Сумма, ₽</th><th>Кол-во</th></tr></thead><tbody>' +
      d.items.slice(0, 15).map(i => `<tr><td>${esc(i.name)}</td><td>${fmt(i.sum)}</td><td>${fmt(i.amount)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) {
    chartContainer.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
    accountsTableEl.innerHTML = '';
    itemsTableEl.innerHTML = '';
  }
}

function startPage() {
  loadWarehouse(30);
}

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadWarehouse(parseInt(btn.dataset.days, 10), btn);
  });
});
