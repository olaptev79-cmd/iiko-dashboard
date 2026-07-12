// Wave 7 (#50): chat UI over the whitelist-router assistant. The backend maps
// each question to ONE read-only report; this just renders the answer + data.

async function checkStatus() {
  const notice = document.getElementById('assistantNotice');
  try {
    const d = await api('/api/assistant/status');
    if (!d.configured) {
      notice.innerHTML = '<div class="unavailable-box">Ассистент пока не настроен: администратору нужно задать переменную окружения ANTHROPIC_API_KEY на сервере. До этого запросы будут возвращать сообщение о том, что ассистент не настроен.</div>';
    }
  } catch (e) { /* status is best-effort */ }
}

function addMsg(role, html) {
  const log = document.getElementById('chatLog');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-' + role;
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function chatKpi(label, val) { return '<div class="chat-kpi"><div class="chat-kpi-label">' + esc(label) + '</div><div class="chat-kpi-val">' + esc(val) + '</div></div>'; }

function renderData(data) {
  if (!data || typeof data !== 'object') return '';
  if (data.available === false) return '<div class="unavailable-box">' + esc(data.error || 'недоступно') + '</div>';
  if (typeof data.revenue !== 'undefined' && typeof data.orders !== 'undefined') {
    return '<div class="chat-kpis">' + chatKpi('Выручка', fmt(data.revenue) + ' ₽') + chatKpi('Чеки', fmt(data.orders)) +
      (data.avgCheck != null ? chatKpi('Ср. чек', fmt(data.avgCheck) + ' ₽') : '') +
      (data.guests != null ? chatKpi('Гости', fmt(data.guests)) : '') + '</div>';
  }
  if (data.today && data.week && data.month && data.today.avgCheck != null) {
    return '<div class="chat-kpis">' + chatKpi('Сегодня', fmt(data.today.avgCheck) + ' ₽') + chatKpi('Неделя', fmt(data.week.avgCheck) + ' ₽') + chatKpi('Месяц', fmt(data.month.avgCheck) + ' ₽') + '</div>';
  }
  const arrKey = Object.keys(data).find((k) => Array.isArray(data[k]) && data[k].length && typeof data[k][0] === 'object');
  if (arrKey) {
    const arr = data[arrKey].slice(0, 8);
    const cols = Object.keys(arr[0]).slice(0, 4);
    return '<table><thead><tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      arr.map((row) => '<tr>' + cols.map((c) => '<td>' + esc(typeof row[c] === 'number' ? fmt(row[c]) : String(row[c] == null ? '—' : row[c])) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
  }
  return '';
}

async function ask(question) {
  if (!question || !question.trim()) return;
  addMsg('user', esc(question));
  const thinking = addMsg('bot', '<span class="chat-thinking">Думаю…</span>');
  try {
    const d = await api('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    if (!d.available) { thinking.innerHTML = '<div class="unavailable-box">' + esc(d.error || 'Ассистент недоступен') + '</div>'; return; }
    thinking.innerHTML = '<div class="chat-answer">' + esc(d.answer || '') + '</div>' + renderData(d.data);
  } catch (e) {
    thinking.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

document.getElementById('chatSendBtn').addEventListener('click', () => {
  const inp = document.getElementById('chatInput');
  ask(inp.value);
  inp.value = '';
});
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { ask(e.target.value); e.target.value = ''; }
});
document.getElementById('chatSuggestions').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) ask(chip.dataset.q);
});

function startPage() {
  checkStatus();
}
