
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
    const t = chartTheme();
    const ctx = document.getElementById('chartPerf').getContext('2d');
    if (chartPerf) chartPerf.destroy();
    chartPerf = new Chart(ctx, {
      type: 'bar',
      data: { labels: top.map(e => e.name), datasets: [{ label: 'Выручка, ₽', data: top.map(e => e.revenue), backgroundColor: t.accent, borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: t.text }, grid: { color: t.grid } }, y: { ticks: { color: t.legend }, grid: { display: false } } } },
    });
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

let directoryEmployees = [];

async function loadDirectory() {
  const el = document.getElementById('directoryContainer');
  try {
    const d = await api('/api/employees/directory');
    if (!d.available) {
      el.innerHTML = '<div class="unavailable-box">Справочник сотрудников недоступен: ' + esc(d.error || 'нет доступа к /resto/api/employees') + '</div>';
      return;
    }
    directoryEmployees = d.employees;
    if (!d.employees.length) { el.innerHTML = '<div class="empty-box">Нет данных</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Имя</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead><tbody>' +
      d.employees.map((e, i) => `<tr><td>${esc(e.name)}</td><td>${esc(e.role)}</td><td>${esc(e.status)}</td>` +
        `<td>${e.id != null ? `<button type="button" class="btn-row-action" data-edit-idx="${i}">Редактировать</button>` : '—'}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// Rows (and their "Редактировать" buttons) are re-created on every
// loadDirectory() call via innerHTML, so a static querySelectorAll+forEach
// binding (used elsewhere in this file for the fixed period buttons) would
// only ever bind to the first render. Event delegation on the stable
// container handles every past/future row without re-binding.
document.getElementById('directoryContainer').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit-idx]');
  if (!btn) return;
  const employee = directoryEmployees[parseInt(btn.dataset.editIdx, 10)];
  if (employee) openCredentialsModal(employee);
});

const PIN_RE = /^\d{4}$/;
const PASSWORD_MIN_LEN = 6;

function openCredentialsModal(employee) {
  openModal({
    title: 'Редактировать сотрудника: ' + esc(employee.name),
    bodyHtml: `
      <div class="field">
        <label for="credLogin">Логин</label>
        <input id="credLogin" type="text" value="${esc(employee.login || '')}" autocomplete="off"/>
      </div>
      <div class="field">
        <label for="credPassword">Новый пароль</label>
        <input id="credPassword" type="password" autocomplete="new-password" placeholder="••••••••"/>
        <div class="field-hint">Оставьте пустым, чтобы не менять пароль</div>
      </div>
      <div class="field">
        <label for="credPasswordConfirm">Подтверждение пароля</label>
        <input id="credPasswordConfirm" type="password" autocomplete="new-password" placeholder="••••••••"/>
      </div>
      <div class="field">
        <label for="credPin">PIN-код (4 цифры)</label>
        <input id="credPin" type="text" inputmode="numeric" maxlength="4" placeholder="••••"/>
        <div class="field-hint">Оставьте пустым, чтобы не менять PIN-код</div>
      </div>
      <div class="login-error" id="credError"></div>
    `,
    footerHtml: `
      <button type="button" class="btn-ghost" id="credCancelBtn">Отмена</button>
      <button type="button" class="btn-primary" id="credSaveBtn" style="width:auto;margin-top:0;">Сохранить</button>
    `,
    onMount: (modalEl) => {
      modalEl.querySelector('#credCancelBtn').addEventListener('click', closeModal);
      modalEl.querySelector('#credSaveBtn').addEventListener('click', () => saveCredentials(employee.id, modalEl));
    },
  });
}

function validateCredentialsForm(login, password, passwordConfirm, pin) {
  if (!login) return 'Укажите логин';
  if (password || passwordConfirm) {
    if (!password || !passwordConfirm) return 'Заполните оба поля пароля';
    if (password.length < PASSWORD_MIN_LEN) return `Пароль должен содержать не менее ${PASSWORD_MIN_LEN} символов`;
    if (password !== passwordConfirm) return 'Пароли не совпадают';
  }
  if (pin && !PIN_RE.test(pin)) return 'PIN-код должен состоять ровно из 4 цифр';
  return null;
}

async function saveCredentials(employeeId, modalEl) {
  const login = modalEl.querySelector('#credLogin').value.trim();
  const password = modalEl.querySelector('#credPassword').value;
  const passwordConfirm = modalEl.querySelector('#credPasswordConfirm').value;
  const pin = modalEl.querySelector('#credPin').value.trim();
  const errBox = modalEl.querySelector('#credError');
  errBox.classList.remove('visible');

  const validationError = validateCredentialsForm(login, password, passwordConfirm, pin);
  if (validationError) {
    errBox.textContent = validationError;
    errBox.classList.add('visible');
    return;
  }

  const saveBtn = modalEl.querySelector('#credSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохраняем...';
  try {
    await api('/api/employees/' + encodeURIComponent(employeeId) + '/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: password || undefined, passwordConfirm: passwordConfirm || undefined, pin: pin || undefined }),
    });
    toast('Учётные данные сотрудника сохранены', 'success');
    closeModal();
    loadDirectory();
  } catch (e) {
    errBox.textContent = e.message || 'Не удалось сохранить учётные данные';
    errBox.classList.add('visible');
    toast('Ошибка сохранения: ' + (e.message || 'неизвестная ошибка'), 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
}

// ---- #18 Геймификация ----
async function loadGamification() {
  const el = document.getElementById('gamificationContainer');
  try {
    const d = await api('/api/gamification?days=30');
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет данных') + '</div>'; return; }
    if (!d.players.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    const medal = (r) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : String(r);
    el.innerHTML = '<table><thead><tr><th>#</th><th>Сотрудник</th><th>Очки</th><th>Бейджи</th></tr></thead><tbody>' +
      d.players.map((p) => `<tr><td>${medal(p.rank)}</td><td>${esc(p.name)}</td><td><strong>${fmt(p.points)}</strong></td>` +
        `<td>${p.badges.map((b) => `<span class="badge badge-a" style="margin-right:4px;">${esc(b)}</span>`).join('') || '—'}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

// ---- #5 Тепловая карта касс ----
async function loadHeatmap() {
  const el = document.getElementById('heatmapContainer');
  try {
    const d = await api('/api/register-heatmap?days=30');
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет данных') + '</div>'; return; }
    if (!d.cashiers.length) { el.innerHTML = '<div class="empty-box">Нет данных за период</div>'; return; }
    const hoursHeader = Array.from({ length: 24 }, (_, h) => `<th class="hm-h">${h}</th>`).join('');
    const rows = d.cashiers.map((c) => {
      const cells = c.hours.map((v, h) => {
        const op = v > 0 ? (0.12 + 0.88 * v / d.maxCell).toFixed(2) : 0;
        return `<td class="hm-cell" style="background:rgba(224,147,46,${op});" title="${esc(c.name)} · ${h}:00 · ${fmt(v)} ₽"></td>`;
      }).join('');
      return `<tr><td class="hm-name">${esc(c.name)}</td>${cells}</tr>`;
    }).join('');
    el.innerHTML = '<div class="heatmap-scroll"><table class="heatmap"><thead><tr><th class="hm-name"></th>' + hoursHeader + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

function startPage() {
  loadPerformance(30);
  loadDirectory();
  loadGamification();
  loadHeatmap();
}

onThemeChangeRedrawCharts(() => { loadPerformance(30); });

// Делегирование кликов по кнопкам периода (без inline onclick — требование CSP)
document.querySelectorAll('.period-btn[data-days]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    loadPerformance(parseInt(btn.dataset.days, 10), btn);
  });
});
