
let chartBranches = null;

async function loadBranches(days, btn) {
  document.querySelectorAll('#appScreen .card .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('branchesTable');
  try {
    const d = await api('/api/branches?days=' + days);
    if (!d.branches.length) {
      document.getElementById('chartBranches').parentElement.querySelector('canvas').style.display = 'none';
      el.innerHTML = '<div class="empty-box">Нет данных за период</div>';
      return;
    }
    const ctx = document.getElementById('chartBranches').getContext('2d');
    if (chartBranches) chartBranches.destroy();
    chartBranches = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.branches.map(b => b.name),
        datasets: [
          { label: 'Текущий период', data: d.branches.map(b => b.revenue), backgroundColor: '#4f98a3', borderRadius: 4 },
          { label: 'Предыдущий период', data: d.branches.map(b => b.prevRevenue), backgroundColor: '#393836', borderRadius: 4 },
        ],
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#cdccca' } } }, scales: { x: { ticks: { color: '#797876' }, grid: { display: false } }, y: { ticks: { color: '#797876' }, grid: { color: '#393836' } } } },
    });

    el.innerHTML = '<table><thead><tr><th>Филиал</th><th>Выручка</th><th>Чеки</th><th>Пред. период</th><th>Изменение</th></tr></thead><tbody>' +
      d.branches.map(b => {
        const cls = deltaClass(b.changePct);
        return `<tr><td>${esc(b.name)}</td><td>${fmt(b.revenue)} ₽</td><td>${fmt(b.orders)}</td><td>${fmt(b.prevRevenue)} ₽</td><td class="branch-change ${cls}" style="text-align:left;">${deltaArrow(b.changePct)} ${fmtPct(b.changePct)}</td></tr>`;
      }).join('') + '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

async function loadDepartments() {
  const el = document.getElementById('departmentsTable');
  try {
    const d = await api('/api/departments');
    if (!d.departments.length) { el.innerHTML = '<div class="empty-box">Нет данных</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Название</th><th>Тип</th></tr></thead><tbody>' +
      d.departments.map(dep => `<tr><td>${esc(dep.name || dep.Name || '—')}</td><td>${esc(dep.type || dep.Type || '—')}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadBranches(30);
  loadDepartments();
}

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadBranches(parseInt(btn.dataset.days, 10), btn);
  });
});
