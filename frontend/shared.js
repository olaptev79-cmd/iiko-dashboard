// Shared across all pages: API client, auth/login flow, header + nav rendering.
const API = window.location.hostname === 'localhost' && window.location.port === '3000' ? 'http://localhost:3001' : '';
const LS_KEY = 'aqba_login_prefs';
const THEME_KEY = 'aqba_theme';

const PAGES = [
  { href: 'index.html', label: 'Обзор' },
  { href: 'sales.html', label: 'Продажи' },
  { href: 'dishes.html', label: 'Меню' },
  { href: 'branches.html', label: 'Филиалы' },
  { href: 'payments.html', label: 'Оплаты' },
  { href: 'employees.html', label: 'Сотрудники' },
  { href: 'warehouse.html', label: 'Склад' },
];

async function api(path, opts = {}) {
  const r = await fetch(API + path, { credentials: 'include', ...opts });
  // A 401 from the login endpoint itself means "wrong credentials / iiko
  // rejected the login", NOT "your session expired" (there is no session
  // yet at that point). Only treat 401 on OTHER endpoints as an expired
  // session, otherwise a real login failure gets mislabeled and the actual
  // reason (from the backend's error message) is hidden from the user.
  if (r.status === 401) {
    const body = await r.json().catch(() => ({}));
    if (path === '/api/auth/login') {
      throw new Error(body.error || 'Не удалось авторизоваться на сервере iiko');
    }
    showLogin();
    throw new Error('not_authenticated');
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || ('HTTP ' + r.status));
  }
  return r.json();
}

// XSS guard: every string that ultimately comes from the iiko server (dish
// names, categories, department/branch names, employee names, etc.) must be
// escaped before being inserted via innerHTML/template strings, since iiko
// data is technically attacker-controllable (anyone who can rename a dish
// or an employee in iiko could otherwise inject markup/script here).
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------- Theme (light/dark) ----------------
// The actual initial theme class is applied synchronously by an inline
// script in <head> (before shared.js loads) to avoid a flash of the wrong
// theme. This section just wires up the toggle button(s) and keeps
// localStorage in sync.
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему';
  });
}
function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
}
function bindThemeToggles() {
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
  applyTheme(getTheme());
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
      errBox.textContent = err.message || 'Не удалось подключиться к серверу iiko';
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
  bindThemeToggles();
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
