// Shared across all pages: API client, auth/login flow, header + nav rendering.
const API = window.location.hostname === 'localhost' && window.location.port === '3000' ? 'http://localhost:3001' : '';
const LS_KEY = 'aqba_login_prefs';

const PAGES = [
  { href: 'index.html', label: 'Обзор' },
  { href: 'sales.html', label: 'Продажи' },
  { href: 'dishes.html', label: 'Меню' },
  { href: 'branches.html', label: 'Филиалы' },
  { href: 'payments.html', label: 'Оплаты' },
  { href: 'employees.html', label: 'Сотрудники' },
];

async function api(path, opts = {}) {
  const r = await fetch(API + path, { credentials: 'include', ...opts });
  if (r.status === 401) { showLogin(); throw new Error('not_authenticated'); }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || ('HTTP ' + r.status));
  }
  return r.json();
}

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }); }
function fmtPct(n) { const v = Number(n || 0); return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
function deltaClass(n) { const v = Number(n || 0); return v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat'; }
function deltaArrow(n) { const v = Number(n || 0); return v > 0.05 ? '↑' : v < -0.05 ? '↓' : '→'; }

function loadSavedPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const { server, login } = JSON.parse(raw);
    const fServer = document.getElementById('fServer');
    const fLogin = document.getElementById('fLogin');
    if (server && fServer) fServer.value = server;
    if (login && fLogin) fLogin.value = login;
  } catch {}
}

function showLogin() {
  clearPolling();
  const app = document.getElementById('appScreen');
  const login = document.getElementById('loginScreen');
  if (app) app.classList.add('hidden');
  if (login) login.classList.remove('hidden');
}

function showApp() {
  const app = document.getElementById('appScreen');
  const login = document.getElementById('loginScreen');
  if (login) login.classList.add('hidden');
  if (app) app.classList.remove('hidden');
  renderNav();
  if (typeof startPage === 'function') startPage();
}

function renderNav() {
  const navEl = document.getElementById('mainNav');
  if (!navEl) return;
  const current = window.location.pathname.split('/').pop() || 'index.html';
  navEl.innerHTML = PAGES.map(p =>
    `<a href="${p.href}" class="${p.href === current ? 'active' : ''}">${p.label}</a>`
  ).join('');
}

function bindLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const server = document.getElementById('fServer').value.trim();
    const login = document.getElementById('fLogin').value.trim();
    const password = document.getElementById('fPassword').value;
    const remember = document.getElementById('fRemember').checked;
    const errBox = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    errBox.classList.remove('visible');
    btn.disabled = true;
    btn.textContent = 'Входим...';
    try {
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: server, login, password }),
      });
      if (remember) {
        localStorage.setItem(LS_KEY, JSON.stringify({ server, login }));
      } else {
        localStorage.removeItem(LS_KEY);
      }
      document.getElementById('fPassword').value = '';
      showApp();
    } catch (err) {
      errBox.textContent = err.message === 'not_authenticated'
        ? 'Сессия истекла, попробуйте снова'
        : (err.message || 'Не удалось подключиться к серверу iiko');
      errBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  });
}

function bindLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    showLogin();
  });
}

async function loadStatus() {
  try {
    const d = await api('/api/health');
    const dot = document.getElementById('dot');
    const txt = document.getElementById('statusText');
    if (!dot || !txt) return;
    dot.className = 'status-dot ' + (d.status === 'online' ? 'online' : 'offline');
    txt.textContent = d.status === 'online' ? 'Онлайн — ' + d.url : 'Сервер недоступен';
  } catch (e) {
    if (e.message !== 'not_authenticated') {
      const dot = document.getElementById('dot');
      const txt = document.getElementById('statusText');
      if (dot) dot.className = 'status-dot offline';
      if (txt) txt.textContent = 'Ошибка соединения';
    }
  }
}

let pollTimers = [];
function clearPolling() {
  pollTimers.forEach(clearInterval);
  pollTimers = [];
}
function startCommonPolling() {
  loadStatus();
  clearPolling();
  pollTimers.push(setInterval(loadStatus, 30000));
}

function downloadCsv(path, filename) {
  const a = document.createElement('a');
  a.href = API + path;
  a.download = filename || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------- Boot (shared across pages) ----------------
async function bootShared() {
  loadSavedPrefs();
  bindLoginForm();
  bindLogout();
  try {
    await api('/api/auth/me');
    showApp();
    startCommonPolling();
  } catch {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', bootShared);
