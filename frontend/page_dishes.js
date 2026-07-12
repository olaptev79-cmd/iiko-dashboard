
let chartCategories = null, chartAbc = null, currentDays = 30;

async function loadMenu(days, btn) {
  currentDays = days;
  document.querySelectorAll('#appScreen .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadWorstDishes(days);
  loadMargin(days);
  loadDishRepeats(days);
  loadAbcXyz(days);
  loadMenuEng(days);
  loadCombos(days);
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

// ---- Аутсайдеры меню (#13) ----
async function loadWorstDishes(days) {
  const el = document.getElementById('worstDishesTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/worst-dishes?days=' + days);
    if (!d.dishes.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>#</th><th>Блюдо</th><th>Кол-во</th><th>Выручка, ₽</th></tr></thead><tbody>' +
      d.dishes.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmt(r.amount)}</td><td>${fmt(r.revenue)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// ---- Маржинальность блюд (#14) ----
async function loadMargin(days) {
  const el = document.getElementById('marginTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/dish-margin?days=' + days);
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет поля себестоимости на этом сервере iiko') + '</div>'; return; }
    if (!d.dishes.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Блюдо</th><th>Выручка, ₽</th><th>Себест., ₽</th><th>Маржа, ₽</th><th>Маржа, %</th></tr></thead><tbody>' +
      d.dishes.slice(0, 20).map((r) => {
        const cls = r.marginPct < 0 ? 'down' : r.marginPct < 25 ? 'flat' : 'up';
        return `<tr><td>${esc(r.name)}</td><td>${fmt(r.revenue)}</td><td>${fmt(r.cost)}</td><td>${fmt(r.margin)}</td><td class="delta ${cls}">${r.marginPct}%</td></tr>`;
      }).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// ---- Повторы блюд в чеке (#7) ----
async function loadDishRepeats(days) {
  const el = document.getElementById('repeatDishesTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/dish-repeats?days=' + days);
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет данных') + '</div>'; return; }
    if (!d.dishes.length) { el.innerHTML = '<div class="empty-box">Повторов блюд в одном чеке за период не найдено</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>#</th><th>Блюдо</th><th>Заказов с повтором</th><th>Доп. порций</th></tr></thead><tbody>' +
      d.dishes.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmt(r.repeatOrders)}</td><td>${fmt(r.extraUnits)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// ---- #2 ABC-XYZ ----
async function loadAbcXyz(days) {
  const el = document.getElementById('abcXyzTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/abc-xyz?days=' + days);
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет данных') + '</div>'; return; }
    if (!d.dishes.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    const xcls = (x) => x === 'X' ? 'badge-a' : x === 'Y' ? 'badge-b' : 'badge-c';
    el.innerHTML = '<table><thead><tr><th>#</th><th>Блюдо</th><th>Выручка, ₽</th><th>ABC</th><th>Разброс</th><th>XYZ</th><th>Класс</th></tr></thead><tbody>' +
      d.dishes.slice(0, 30).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmt(r.revenue)}</td><td><span class="badge badge-${esc(String(r.abc).toLowerCase())}">${esc(r.abc)}</span></td><td>${r.cov}%</td><td><span class="badge ${xcls(r.xyz)}">${esc(r.xyz)}</span></td><td><strong>${esc(r.combo)}</strong></td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// ---- #11 Меню-инжиниринг ----
async function loadMenuEng(days) {
  const el = document.getElementById('menuEngTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/menu-engineering?days=' + days);
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет себестоимости') + '</div>'; return; }
    if (!d.dishes.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    const qcls = { star: 'badge-a', plowhorse: 'badge-b', puzzle: 'badge-b', dog: 'badge-c' };
    const head = '<div style="margin-bottom:12px;font-size:12.5px;color:var(--muted);">⭐ Звёзды: ' + d.counts.star + ' · 🐴 Лошадки: ' + d.counts.plowhorse + ' · ❓ Загадки: ' + d.counts.puzzle + ' · 🐕 Собаки: ' + d.counts.dog + '</div>';
    el.innerHTML = head + '<table><thead><tr><th>Блюдо</th><th>Кол-во</th><th>Маржа,%</th><th>Квадрант</th></tr></thead><tbody>' +
      d.dishes.slice(0, 25).map((r) => `<tr><td>${esc(r.name)}</td><td>${fmt(r.amount)}</td><td>${r.marginPct}%</td><td><span class="badge ${qcls[r.quadrant]}">${esc(r.quadrantLabel)}</span></td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// ---- #12 Сочетания блюд ----
async function loadCombos(days) {
  const el = document.getElementById('combosTable');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/dish-combos?days=' + days);
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет номера заказа') + '</div>'; return; }
    if (!d.pairs.length) { el.innerHTML = '<div class="empty-box">Частых сочетаний не найдено</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>#</th><th>Сочетание</th><th>Раз вместе</th></tr></thead><tbody>' +
      d.pairs.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.pair)}</td><td>${fmt(p.count)}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
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
