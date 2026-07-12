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

document.getElementById('attApplyBtn').addEventListener('click', () => {
  const range = readDateRange('attFrom', 'attTo');
  if (!range) { toast('Проверьте даты периода — начало должно быть раньше окончания', 'error'); return; }
  loadAttendance();
});

function startPage() {
  const range = defaultAttendanceRange();
  document.getElementById('attFrom').value = range.from;
  document.getElementById('attTo').value = range.to;
  loadEmployeeFilter();
  loadAttendance();
}
