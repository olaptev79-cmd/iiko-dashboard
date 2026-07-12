let attendanceRecords = [];
let attendancePager = null;

function fmtDate(d) { return d ? d.slice(0, 10) : ''; }
function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return esc(String(v));
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function defaultAttendanceRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: fmt(from), to: fmt(to) };
}

async function loadEmployeeFilter() {
  const select = document.getElementById('attEmployee');
  try {
    const d = await api('/api/employees/directory');
    if (!d.available || !d.employees.length) return;
    d.employees.filter((e) => e.id != null).forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.name;
      select.appendChild(opt);
    });
  } catch (e) { /* directory unavailable — filter just stays "Все сотрудники" */ }
}

function renderAttendancePage(pageRows) {
  const el = document.getElementById('attendanceContainer');
  el.innerHTML = '<table><thead><tr><th>Сотрудник</th><th>Дата</th><th>Приход</th><th>Уход</th><th>Часов</th></tr></thead><tbody>' +
    pageRows.map((r) => `<tr><td>${esc(r.employeeName)}</td><td>${esc(fmtDate(r.date))}</td><td>${fmtTime(r.clockIn)}</td><td>${fmtTime(r.clockOut)}</td><td>${r.hours != null ? fmt(r.hours) : '—'}</td></tr>`).join('') +
    '</tbody></table>';
}

async function loadAttendance() {
  const range = readDateRange('attFrom', 'attTo') || defaultAttendanceRange();
  document.getElementById('attFrom').value = range.from;
  document.getElementById('attTo').value = range.to;
  const employeeId = document.getElementById('attEmployee').value;

  const el = document.getElementById('attendanceContainer');
  const pagerEl = document.getElementById('attendancePagination');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  pagerEl.innerHTML = '';
  try {
    let path = '/api/employees/attendance?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to);
    if (employeeId) path += '&employeeId=' + encodeURIComponent(employeeId);
    const d = await api(path);
    if (!d.available) {
      el.innerHTML = '<div class="unavailable-box">Учёт явок недоступен на этом сервере iiko: ' + esc(d.error || 'нет данных') + '</div>';
      return;
    }
    attendanceRecords = d.records;
    if (!attendanceRecords.length) { el.innerHTML = '<div class="empty-box">Нет данных о явках за период</div>'; return; }
    attendancePager = paginate(attendanceRecords, 20, pagerEl, renderAttendancePage);
  } catch (e) {
    el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

// ---- Аномалии по сменам (#17) ----
async function loadAnomalies(range) {
  const el = document.getElementById('attendanceAnomalies');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const d = await api('/api/attendance-anomalies?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to));
    if (!d.available) { el.innerHTML = '<div class="unavailable-box">Недоступно: ' + esc(d.error || 'нет данных') + '</div>'; return; }
    let html = '<div class="yoy-row" style="margin-bottom:16px;">' +
      `<div class="yoy-tile"><div class="yoy-label">Смен всего</div><div class="yoy-value">${fmt(d.totalShifts)}</div></div>` +
      `<div class="yoy-tile"><div class="yoy-label">Коротких (&lt;4ч)</div><div class="yoy-value">${fmt(d.shortCount)}</div></div>` +
      `<div class="yoy-tile"><div class="yoy-label">Переработок (&gt;12ч)</div><div class="yoy-value">${fmt(d.longCount)}</div></div>` +
      `<div class="yoy-tile"><div class="yoy-label">Средняя смена</div><div class="yoy-value">${fmt(d.avgHours)} ч</div></div>` +
    '</div>';
    if (d.flagged.length) {
      html += '<table><thead><tr><th>Сотрудник</th><th>Дата</th><th>Часов</th><th>Отметка</th></tr></thead><tbody>' +
        d.flagged.map((r) => `<tr><td>${esc(r.employeeName)}</td><td>${esc(fmtDate(r.date))}</td><td>${fmt(r.hours)}</td>` +
          `<td><span class="delta ${r.flag === 'short' ? 'down' : 'flat'}">${r.flag === 'short' ? 'короткая' : 'переработка'}</span></td></tr>`).join('') +
        '</tbody></table>';
    } else {
      html += '<div class="empty-box">Аномалий по сменам за период нет</div>';
    }
    el.innerHTML = html;
  } catch (e) { el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>'; }
}

const ATT_FILTER_IDS = ['attFrom', 'attTo', 'attEmployee'];

function applyAttendance() {
  const range = readDateRange('attFrom', 'attTo');
  if (!range) { toast('Проверьте даты периода — начало должно быть раньше окончания', 'error'); return; }
  saveFilterState('attendance', ATT_FILTER_IDS);
  loadAttendance();
  loadAnomalies(range);
}

document.getElementById('attApplyBtn').addEventListener('click', applyAttendance);
document.getElementById('attResetBtn').addEventListener('click', () => {
  clearFilterState('attendance');
  const range = defaultAttendanceRange();
  document.getElementById('attFrom').value = range.from;
  document.getElementById('attTo').value = range.to;
  document.getElementById('attEmployee').value = '';
  loadAttendance();
  loadAnomalies(range);
  toast('Фильтры сброшены', 'info');
});

async function startPage() {
  const range = defaultAttendanceRange();
  document.getElementById('attFrom').value = range.from;
  document.getElementById('attTo').value = range.to;
  // Populate employee dropdown first so a saved employee selection can be restored.
  await loadEmployeeFilter();
  restoreFilterState('attendance', ATT_FILTER_IDS);
  const effRange = readDateRange('attFrom', 'attTo') || range;
  loadAttendance();
  loadAnomalies(effRange);
}
