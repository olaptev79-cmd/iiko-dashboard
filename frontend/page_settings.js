let auditEvents = [];
let allUsersCache = [];

function fmtTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return esc(String(iso));
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ROLE_LABELS = { viewer: 'Просмотр', editor: 'Редактор', admin: 'Администратор' };

// Returns false specifically when the acting user isn't an admin (server's
// requireRole 403), so startPage() can swap in one explanatory message
// instead of two separate error boxes (users + audit both 403 identically
// for a non-admin who reached this page directly by URL).
async function loadUsers() {
  const el = document.getElementById('usersContainer');
  try {
    const d = await api('/api/admin/users');
    if (!d.users.length) { el.innerHTML = '<div class="empty-box">Нет данных</div>'; return true; }
    el.innerHTML = '<table><thead><tr><th>Логин</th><th>Роль</th><th>Последний вход</th><th>2FA</th><th>Действия</th></tr></thead><tbody>' +
      d.users.map((u, i) => `<tr><td>${esc(u.login)}</td><td>${esc(ROLE_LABELS[u.role] || u.role)}</td><td>${fmtTs(u.lastLoginAt)}</td><td>${u.totpEnabled ? 'включена' : '—'}</td>` +
        `<td><select class="role-select" data-login-idx="${i}">` +
        Object.keys(ROLE_LABELS).map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${ROLE_LABELS[r]}</option>`).join('') +
        `</select></td></tr>`).join('') +
      '</tbody></table>';
    el.dataset.users = JSON.stringify(d.users.map((u) => u.login));
    allUsersCache = d.users;
    return true;
  } catch (e) {
    if (e.message === 'not_authenticated') return true;
    if (e.message && e.message.includes('Недостаточно прав')) return false;
    el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
    return true;
  }
}

document.getElementById('usersContainer').addEventListener('change', async (e) => {
  const select = e.target.closest('.role-select');
  if (!select) return;
  const logins = JSON.parse(document.getElementById('usersContainer').dataset.users || '[]');
  const login = logins[parseInt(select.dataset.loginIdx, 10)];
  const role = select.value;
  try {
    await api('/api/admin/users/' + encodeURIComponent(login) + '/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    toast('Роль пользователя ' + login + ' изменена на «' + ROLE_LABELS[role] + '»', 'success');
    loadAudit();
  } catch (err) {
    toast('Не удалось изменить роль: ' + (err.message || 'неизвестная ошибка'), 'error');
    loadUsers();
  }
});

const AUDIT_ACTION_LABELS = {
  login: 'Вход',
  authz_denied: 'Отказано в доступе',
  role_change: 'Изменение роли',
  totp_enabled: 'Включена 2FA',
  totp_disabled: 'Отключена 2FA',
  login_totp: 'Неверный код 2FA',
};

// ---------------- Two-factor authentication (self-service) ----------------

async function loadTotpSection() {
  const el = document.getElementById('totpContainer');
  try {
    const me = await api('/api/auth/me');
    const myRecord = allUsersCache.find((u) => u.login === me.login);
    const enabled = myRecord ? myRecord.totpEnabled : false;
    if (enabled) {
      el.innerHTML = '<p>Включена для вашей учётной записи (' + esc(me.login) + ').</p>' +
        '<button class="btn-ghost" id="totpDisableBtn" type="button" style="margin-top:12px;">Отключить 2FA</button>';
      document.getElementById('totpDisableBtn').addEventListener('click', disableTotp);
    } else {
      el.innerHTML = '<p>Не включена. Рекомендуется включить для защиты входа в дашборд.</p>' +
        '<button class="btn-primary" id="totpEnableBtn" type="button" style="width:auto;margin-top:12px;">Включить 2FA</button>';
      document.getElementById('totpEnableBtn').addEventListener('click', startTotpEnrollment);
    }
  } catch (e) {
    if (e.message === 'not_authenticated') return;
    el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

async function startTotpEnrollment() {
  let setupData;
  try {
    setupData = await api('/api/auth/totp-setup', { method: 'POST' });
  } catch (e) {
    toast('Не удалось начать настройку 2FA: ' + (e.message || 'неизвестная ошибка'), 'error');
    return;
  }
  openModal({
    title: 'Включение двухфакторной аутентификации',
    bodyHtml: `
      <p style="margin-bottom:14px;color:var(--muted);font-size:13px;">Отсканируйте QR-код в приложении-аутентификаторе (Google Authenticator, Authy и т.п.), затем введите текущий код для подтверждения.</p>
      <img src="${setupData.qrDataUrl}" alt="QR-код для 2FA" width="200" height="200" style="display:block;margin:0 auto 16px;border-radius:8px;"/>
      <div class="field">
        <label for="totpConfirmCode">Код из приложения</label>
        <input id="totpConfirmCode" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"/>
      </div>
      <div class="login-error" id="totpConfirmError"></div>
    `,
    footerHtml: `
      <button type="button" class="btn-ghost" id="totpEnrollCancelBtn">Отмена</button>
      <button type="button" class="btn-primary" id="totpEnrollConfirmBtn" style="width:auto;margin-top:0;">Подтвердить</button>
    `,
    onMount: (modalEl) => {
      modalEl.querySelector('#totpConfirmCode').focus();
      modalEl.querySelector('#totpEnrollCancelBtn').addEventListener('click', closeModal);
      const confirmEnrollment = async () => {
        const code = modalEl.querySelector('#totpConfirmCode').value.trim();
        const errBox = modalEl.querySelector('#totpConfirmError');
        errBox.classList.remove('visible');
        try {
          await api('/api/auth/totp-confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: setupData.secret, code }),
          });
          toast('Двухфакторная аутентификация включена', 'success');
          closeModal();
          await loadUsers();
          loadTotpSection();
        } catch (err) {
          errBox.textContent = err.message || 'Неверный код';
          errBox.classList.add('visible');
        }
      };
      modalEl.querySelector('#totpEnrollConfirmBtn').addEventListener('click', confirmEnrollment);
      modalEl.querySelector('#totpConfirmCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmEnrollment(); });
    },
  });
}

async function disableTotp() {
  try {
    await api('/api/auth/totp-disable', { method: 'POST' });
    toast('Двухфакторная аутентификация отключена', 'success');
    await loadUsers();
    loadTotpSection();
  } catch (e) {
    toast('Не удалось отключить 2FA: ' + (e.message || 'неизвестная ошибка'), 'error');
  }
}

function renderAuditPage(pageRows) {
  const el = document.getElementById('auditContainer');
  el.innerHTML = '<table><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Цель</th><th>Результат</th></tr></thead><tbody>' +
    pageRows.map((e) => `<tr><td>${fmtTs(e.ts)}</td><td>${esc(e.actingLogin || '—')}</td><td>${esc(AUDIT_ACTION_LABELS[e.action] || e.action)}</td><td>${esc(e.target || '—')}</td><td>${e.result === 'ok' ? 'успех' : 'отказ'}</td></tr>`).join('') +
    '</tbody></table>';
}

async function loadAudit() {
  const el = document.getElementById('auditContainer');
  const pagerEl = document.getElementById('auditPagination');
  try {
    const d = await api('/api/admin/audit-log?limit=500');
    auditEvents = d.events;
    if (!auditEvents.length) { el.innerHTML = '<div class="empty-box">Событий пока нет</div>'; return; }
    paginate(auditEvents, 25, pagerEl, renderAuditPage);
  } catch (e) {
    if (e.message === 'not_authenticated') return;
    el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

// ---------------- Scoped tokens (Wave 6) ----------------
const TOKEN_SCOPE_LABELS = { public: 'Публичная ссылка', embed: 'Встраивание', 'external-bi': 'API-ключ BI' };

async function loadTokens() {
  const el = document.getElementById('tokensContainer');
  try {
    const d = await api('/api/admin/tokens');
    if (!d.tokens.length) { el.innerHTML = '<div class="empty-box">Токенов пока нет</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Тип</th><th>Название</th><th>Создан</th><th>Истекает</th><th>Использован</th><th>Статус</th><th></th></tr></thead><tbody>' +
      d.tokens.map((t) => `<tr><td>${esc(TOKEN_SCOPE_LABELS[t.scope] || t.scope)}</td><td>${esc(t.label || '—')}</td><td>${fmtTs(t.createdAt)}</td><td>${t.expiresAt ? fmtTs(t.expiresAt) : 'бессрочно'}</td><td>${t.lastUsedAt ? fmtTs(t.lastUsedAt) : '—'}</td><td>${t.revoked ? '<span class="delta down">отозван</span>' : '<span class="delta up">активен</span>'}</td><td>${t.revoked ? '' : `<button class="btn-row-action" data-revoke="${esc(t.id)}">Отозвать</button>`}</td></tr>`).join('') +
      '</tbody></table>';
  } catch (e) {
    if (e.message === 'not_authenticated') return;
    el.innerHTML = '<div class="error-box">Ошибка: ' + esc(e.message) + '</div>';
  }
}

async function createToken() {
  const scope = document.getElementById('tokScope').value;
  const label = document.getElementById('tokLabel').value.trim();
  const ttlDays = document.getElementById('tokTtl').value;
  let d;
  try {
    d = await api('/api/admin/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, label, ttlDays: ttlDays || undefined }) });
  } catch (e) { toast('Не удалось создать токен: ' + (e.message || 'ошибка'), 'error'); return; }
  const origin = window.location.origin;
  let body;
  if (scope === 'public') {
    const url = origin + '/public.html?token=' + encodeURIComponent(d.token);
    body = '<p style="margin-bottom:10px;color:var(--muted);font-size:13px;">Публичная ссылка (только сводные KPI). Токен показывается один раз — скопируйте:</p><textarea readonly class="gsearch-input" style="width:100%;height:70px;">' + esc(url) + '</textarea>';
  } else if (scope === 'embed') {
    const code = '<iframe src="' + origin + '/embed.html?token=' + encodeURIComponent(d.token) + '" width="360" height="220" style="border:0;"></iframe>';
    body = '<p style="margin-bottom:10px;color:var(--muted);font-size:13px;">Код для встраивания. По умолчанию работает на этом же домене; для сторонних сайтов добавьте их в frame-ancestors в nginx.conf:</p><textarea readonly class="gsearch-input" style="width:100%;height:90px;">' + esc(code) + '</textarea>';
  } else {
    body = '<p style="margin-bottom:10px;color:var(--muted);font-size:13px;">API-ключ для BI-систем. Показывается один раз:</p><textarea readonly class="gsearch-input" style="width:100%;height:50px;">' + esc(d.token) + '</textarea>' +
      '<p style="margin-top:10px;color:var(--muted);font-size:12px;word-break:break-all;">Пример: curl -H "Authorization: Bearer &lt;ключ&gt;" ' + esc(origin) + '/api/external/summary</p>';
  }
  openModal({ title: 'Токен создан', bodyHtml: body, footerHtml: '<button type="button" class="btn-primary" id="tokDoneBtn" style="width:auto;margin-top:0;">Готово</button>', onMount: (m) => { m.querySelector('#tokDoneBtn').addEventListener('click', closeModal); const ta = m.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); } } });
  document.getElementById('tokLabel').value = '';
  document.getElementById('tokTtl').value = '';
  loadTokens();
  loadAudit();
}

const _tokCreateBtn = document.getElementById('tokCreateBtn');
if (_tokCreateBtn) _tokCreateBtn.addEventListener('click', createToken);
const _tokContainer = document.getElementById('tokensContainer');
if (_tokContainer) _tokContainer.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-revoke]');
  if (!btn) return;
  try {
    await api('/api/admin/tokens/' + encodeURIComponent(btn.dataset.revoke), { method: 'DELETE' });
    toast('Токен отозван', 'success');
    loadTokens();
    loadAudit();
  } catch (err) { toast('Не удалось отозвать: ' + (err.message || 'ошибка'), 'error'); }
});

async function startPage() {
  const unavailableEl = document.getElementById('settingsUnavailable');
  const contentEl = document.getElementById('settingsContent');
  unavailableEl.innerHTML = '';
  contentEl.classList.remove('hidden');
  const isAdmin = await loadUsers();
  if (!isAdmin) {
    contentEl.classList.add('hidden');
    unavailableEl.innerHTML = '<div class="unavailable-box">Раздел «Настройки» доступен только пользователям с ролью администратора.</div>';
    return;
  }
  loadTotpSection();
  loadAudit();
  loadTokens();
}
