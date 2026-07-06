// Shared across all pages: API client, auth/login flow, header + nav rendering.
const API = window.location.hostname === 'localhost' && window.location.port === '3000' ? 'http://localhost:3001' : '';
const LS_KEY = 'aqba_login_prefs';
const THEME_KEY = 'aqba_theme';

// Each page carries a short inline SVG icon (no external icon library, per
// design brief) plus a `short` label used in the constrained mobile bottom
// tab bar. The first 4 entries + a synthetic "Ещё" (More) button make up the
// bottom nav; the rest live behind the More sheet on mobile.
const PAGES = [
  { href: 'index.html', label: 'Обзор', short: 'Обзор',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>' },
  { href: 'sales.html', label: 'Продажи', short: 'Продажи',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M21 3h-6v6"/></svg>' },
  { href: 'dishes.html', label: 'Меню', short: 'Меню',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v7a2 2 0 0 0 2 2v9"/><path d="M4 3v7"/><path d="M8 3v7"/><path d="M18 3c-2 1-3 3-3 6s1 5 3 6v6"/></svg>' },
  { href: 'branches.html', label: 'Филиалы', short: 'Филиалы',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M10 21v-6h4v6"/></svg>' },
  { href: 'payments.html', label: 'Оплаты и скидки', short: 'Оплаты',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>' },
  { href: 'employees.html', label: 'Сотрудники', short: 'Кадры',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="7.5" r="2.3"/><path d="M16 14.3c2.6.4 4.5 2.4 4.5 5.2"/></svg>' },
  { href: 'warehouse.html', label: 'Склад', short: 'Склад',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>' },
  { href: 'risky.html', label: 'Опасные операции', short: 'Риски',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 1 21h22z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor"/></svg>' },
];

// First N items shown directly in the mobile bottom bar; the rest collapse
// into the "Ещё" (More) slide-up sheet.
const BOTTOM_NAV_PRIMARY_COUNT = 4;

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
const THEME_ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>';
const THEME_ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/></svg>';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.innerHTML = theme === 'light' ? THEME_ICON_MOON : THEME_ICON_SUN;
    btn.title = theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему';
  });
}
function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
  redrawChartsForTheme();
}
function bindThemeToggles() {
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
  applyTheme(getTheme());
}

// ---------------- Chart.js theme helpers ----------------
// Charts are drawn with a canvas API, so they can't inherit CSS variables
// automatically like the rest of the UI. This reads the *current* theme's
// tokens straight from :root so chart text/gridlines stay legible in both
// light and dark mode, and gives every chart a shared, on-brand color
// sequence (instead of ad-hoc hex values that only look right in the dark
// theme they were first written for).
function chartTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    text: v('--muted') || '#9c9585',
    grid: v('--border') || '#3a352c',
    legend: v('--text') || '#ede8dd',
    accent: v('--accent') || '#e0932e',
    risk: v('--risk') || '#e2683f',
    // Categorical series palette derived from the "касса/чек" design system —
    // amber/terracotta family first, then supporting neutrals, so charts
    // read as part of the same visual language on every page/theme.
    series: [v('--accent') || '#e0932e', v('--risk') || '#e2683f', '#4f8a8f', '#8a6d3b', '#6f8f4a', '#b3452e', '#a48a5a', '#5c6b5d'],
  };
}
// Re-render every registered Chart.js instance so colors follow a theme
// switch without a full page reload. Pages push their chart-reload callback
// here after creating a chart.
const _chartReloaders = [];
function onThemeChangeRedrawCharts(fn) { _chartReloaders.push(fn); }
function redrawChartsForTheme() { _chartReloaders.forEach(fn => { try { fn(); } catch {} }); }

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
  const current = window.location.pathname.split('/').pop() || 'index.html';

  // ---- Desktop / tablet sidebar ----
  const sideNav = document.getElementById('mainNav');
  if (sideNav) {
    sideNav.innerHTML = PAGES.map(p =>
      `<a href="${p.href}" class="${p.href === current ? 'active' : ''}" title="${esc(p.label)}">` +
      `<span class="nav-icon">${p.icon}</span><span class="nav-label">${esc(p.label)}</span></a>`
    ).join('');
  }

  // ---- Mobile bottom tab bar (first N items + "Ещё") ----
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    const primary = PAGES.slice(0, BOTTOM_NAV_PRIMARY_COUNT);
    const rest = PAGES.slice(BOTTOM_NAV_PRIMARY_COUNT);
    const restHasActive = rest.some(p => p.href === current);
    let html = primary.map(p =>
      `<a href="${p.href}" class="${p.href === current ? 'active' : ''}">` +
      `<span class="nav-icon">${p.icon}</span><span class="nav-label">${esc(p.short)}</span></a>`
    ).join('');
    if (rest.length) {
      html += `<a href="#" id="moreNavBtn" class="more-btn ${restHasActive ? 'active' : ''}">` +
        `<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></span>` +
        `<span class="nav-label">Ещё</span></a>`;
    }
    bottomNav.innerHTML = html;

    // ---- "More" bottom sheet with remaining items ----
    let backdrop = document.getElementById('moreSheetBackdrop');
    let sheet = document.getElementById('moreSheet');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'moreSheetBackdrop';
      backdrop.className = 'more-sheet-backdrop';
      document.body.appendChild(backdrop);
    }
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'moreSheet';
      sheet.className = 'more-sheet';
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = `<div class="more-sheet-handle"></div>` + rest.map(p =>
      `<a href="${p.href}" class="${p.href === current ? 'active' : ''}">` +
      `<span class="nav-icon">${p.icon}</span><span>${esc(p.label)}</span></a>`
    ).join('');

    const openSheet = () => { backdrop.classList.add('open'); sheet.classList.add('open'); };
    const closeSheet = () => { backdrop.classList.remove('open'); sheet.classList.remove('open'); };
    const moreBtn = document.getElementById('moreNavBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => { e.preventDefault(); openSheet(); });
    }
    backdrop.addEventListener('click', closeSheet);
  }
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
