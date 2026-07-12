// Shared across all pages: API client, auth/login flow, header + nav rendering.
const API = window.location.hostname === 'localhost' && window.location.port === '3000' ? 'http://localhost:3001' : '';
const LS_KEY = 'aqba_login_prefs';
const THEME_KEY = 'aqba_theme';

// Dashboard-own role (viewer/editor/admin, see backend/userStore.js) —
// separate from whatever role the login has inside iiko itself. Cached
// after /api/auth/me on boot; used only to filter which nav items render,
// never as the actual security boundary (that's requireRole() server-side —
// hiding a nav link doesn't stop a direct API call, by design, same
// precedent as every other client-side check in this app).
let currentUserRole = 'viewer';
const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 };
function roleAtLeast(role, min) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[min] ?? Infinity);
}

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
  { href: 'guests.html', label: 'Гости', short: 'Гости',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { href: 'employees.html', label: 'Сотрудники', short: 'Кадры',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="7.5" r="2.3"/><path d="M16 14.3c2.6.4 4.5 2.4 4.5 5.2"/></svg>' },
  { href: 'attendance.html', label: 'Явки сотрудников', short: 'Явки',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>' },
  { href: 'warehouse.html', label: 'Склад', short: 'Склад',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>' },
  { href: 'risky.html', label: 'Опасные операции', short: 'Риски',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 1 21h22z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor"/></svg>' },
  { href: 'settings.html', label: 'Настройки', short: 'Настройки', minRole: 'admin',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' },
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
// #41: when the user hasn't explicitly picked a theme, follow the OS
// (prefers-color-scheme). Mirrors the inline <head> bootstrap so there's no
// flash and no disagreement between first paint and shared.js.
function systemTheme() {
  try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
}
function getTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored || systemTheme();
  } catch { return 'dark'; }
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
  // #41: if the user hasn't chosen a theme, react live to OS theme changes.
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (!localStorage.getItem(THEME_KEY)) { applyTheme(systemTheme()); redrawChartsForTheme(); } };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch {}
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
  applyLanguage();
}

function showApp() {
  const app = document.getElementById('appScreen');
  const login = document.getElementById('loginScreen');
  if (login) login.classList.add('hidden');
  if (app) app.classList.remove('hidden');
  renderNav();
  renderNotificationBell();
  renderGlobalSearchButton();
  renderLangToggle();
  if (typeof startPage === 'function') startPage();
  applyLanguage();
}

function renderNav() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  // Hiding a nav item is a UX nicety, not the security boundary — the
  // matching server route is the real gate (requireRole in server.js).
  // Same precedent as every other client-side check in this app.
  const visiblePages = PAGES.filter(p => !p.minRole || roleAtLeast(currentUserRole, p.minRole));

  // ---- Desktop / tablet sidebar ----
  const sideNav = document.getElementById('mainNav');
  if (sideNav) {
    sideNav.innerHTML = visiblePages.map(p =>
      `<a href="${p.href}" class="${p.href === current ? 'active' : ''}" title="${esc(p.label)}">` +
      `<span class="nav-icon">${p.icon}</span><span class="nav-label">${esc(p.label)}</span></a>`
    ).join('');
  }

  // ---- Mobile bottom tab bar (first N items + "Ещё") ----
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    const primary = visiblePages.slice(0, BOTTOM_NAV_PRIMARY_COUNT);
    const rest = visiblePages.slice(BOTTOM_NAV_PRIMARY_COUNT);
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

// ---------------- Notification bell (#45) ----------------
// Thin UI over the Wave-1 audit log (backend/auditLog.js) — admin-only,
// same data sensitivity as the Settings page's audit table. Injected into
// the header dynamically (like the bell/theme-toggle chrome) instead of
// duplicating markup across all pages.
const BELL_LAST_SEEN_KEY = 'aqba_bell_last_seen';

function renderNotificationBell() {
  const headerRight = document.querySelector('.header-right');
  if (!headerRight) return;
  let btn = document.getElementById('notifBellBtn');
  if (currentUserRole !== 'admin') {
    if (btn) btn.remove();
    return;
  }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'notifBellBtn';
    btn.type = 'button';
    btn.className = 'theme-toggle notif-bell';
    btn.setAttribute('aria-label', 'Уведомления');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span class="notif-badge hidden" id="notifBadge">0</span>';
    headerRight.insertBefore(btn, headerRight.firstChild);
    btn.addEventListener('click', toggleNotifPanel);
  }
  refreshNotifBadge();
}

async function refreshNotifBadge() {
  if (currentUserRole !== 'admin') return;
  try {
    const d = await api('/api/admin/audit-log?limit=50');
    const lastSeen = localStorage.getItem(BELL_LAST_SEEN_KEY) || '';
    const unread = d.events.filter((e) => e.ts > lastSeen).length;
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* not admin / not authenticated yet — bell just stays at 0 */ }
}

async function toggleNotifPanel() {
  let panel = document.getElementById('notifPanel');
  if (panel) { panel.remove(); document.removeEventListener('click', notifOutsideClickHandler); return; }
  panel = document.createElement('div');
  panel.id = 'notifPanel';
  panel.className = 'notif-panel';
  panel.innerHTML = '<div class="loading">Загрузка...</div>';
  document.body.appendChild(panel);
  const btn = document.getElementById('notifBellBtn');
  const rect = btn.getBoundingClientRect();
  panel.style.top = (rect.bottom + 8) + 'px';
  panel.style.right = (window.innerWidth - rect.right) + 'px';
  setTimeout(() => document.addEventListener('click', notifOutsideClickHandler), 0);

  try {
    const d = await api('/api/admin/audit-log?limit=10');
    const NOTIF_LABELS = { login: 'Вход', authz_denied: 'Отказано в доступе', role_change: 'Изменение роли', totp_enabled: 'Включена 2FA', totp_disabled: 'Отключена 2FA', login_totp: 'Неверный код 2FA' };
    panel.innerHTML = !d.events.length
      ? '<div class="empty-box">Событий нет</div>'
      : d.events.map((e) => `<div class="notif-item"><span class="notif-item-action">${esc(NOTIF_LABELS[e.action] || e.action)}</span><span class="notif-item-who">${esc(e.actingLogin || '—')}</span><span class="notif-item-time">${esc(new Date(e.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</span></div>`).join('');
    if (d.events.length) localStorage.setItem(BELL_LAST_SEEN_KEY, d.events[0].ts);
    refreshNotifBadge();
  } catch (e) {
    panel.innerHTML = '<div class="error-box">Ошибка загрузки</div>';
  }
}
function notifOutsideClickHandler(e) {
  const panel = document.getElementById('notifPanel');
  const btn = document.getElementById('notifBellBtn');
  if (panel && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    panel.remove();
    document.removeEventListener('click', notifOutsideClickHandler);
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
      const loginResult = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: server, login, password }),
      });
      document.getElementById('fPassword').value = '';
      if (loginResult.requiresTotp) {
        await promptTotpLogin(loginResult.pendingId, remember, server, login);
      } else {
        currentUserRole = loginResult.role || 'viewer';
        if (remember) {
          localStorage.setItem(LS_KEY, JSON.stringify({ server, login }));
        } else {
          localStorage.removeItem(LS_KEY);
        }
        showApp();
      }
    } catch (err) {
      errBox.textContent = err.message || 'Не удалось подключиться к серверу iiko';
      errBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  });
}

/** Second step of a 2FA-protected login: prompts for the 6-digit TOTP code
 *  via the shared modal (reused rather than duplicating login markup across
 *  all 12 pages), then completes the login the same way the non-2FA path
 *  does. Resolves once the modal is dismissed (success or cancel). */
function promptTotpLogin(pendingId, remember, server, login) {
  return new Promise((resolve) => {
    openModal({
      title: 'Код двухфакторной аутентификации',
      bodyHtml: `
        <div class="field">
          <label for="totpCode">Код из приложения-аутентификатора</label>
          <input id="totpCode" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"/>
        </div>
        <div class="login-error" id="totpError"></div>
      `,
      footerHtml: `
        <button type="button" class="btn-ghost" id="totpCancelBtn">Отмена</button>
        <button type="button" class="btn-primary" id="totpSubmitBtn" style="width:auto;margin-top:0;">Подтвердить</button>
      `,
      onMount: (modalEl) => {
        modalEl.querySelector('#totpCode').focus();
        modalEl.querySelector('#totpCancelBtn').addEventListener('click', () => { closeModal(); resolve(); });
        const submit = async () => {
          const code = modalEl.querySelector('#totpCode').value.trim();
          const errBox = modalEl.querySelector('#totpError');
          errBox.classList.remove('visible');
          if (!/^\d{6}$/.test(code)) {
            errBox.textContent = 'Код должен состоять из 6 цифр';
            errBox.classList.add('visible');
            return;
          }
          try {
            const result = await api('/api/auth/totp-login-verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pendingId, code }),
            });
            currentUserRole = result.role || 'viewer';
            if (remember) {
              localStorage.setItem(LS_KEY, JSON.stringify({ server, login }));
            } else {
              localStorage.removeItem(LS_KEY);
            }
            closeModal();
            showApp();
            resolve();
          } catch (err) {
            errBox.textContent = err.message || 'Неверный код';
            errBox.classList.add('visible');
          }
        };
        modalEl.querySelector('#totpSubmitBtn').addEventListener('click', submit);
        modalEl.querySelector('#totpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      },
    });
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

// ---------------- Toast notifications ----------------
function toast(message, type, durationMs) {
  type = type || 'info';
  durationMs = durationMs || 4000;
  let root = document.getElementById('toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    root.className = 'toast-root';
    document.body.appendChild(root);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); };
  const timer = setTimeout(remove, durationMs);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ---------------- Modal dialog ----------------
// Callers must esc() any dynamic value embedded in title/bodyHtml/footerHtml
// (e.g. an employee name) — same XSS discipline as the rest of the app.
function escHandlerForModal(e) { if (e.key === 'Escape') closeModal(); }
function openModal(opts) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'activeModalBackdrop';
  backdrop.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-header"><h3>' + opts.title + '</h3><button type="button" class="modal-close" aria-label="Закрыть">&times;</button></div>' +
      '<div class="modal-body">' + opts.bodyHtml + '</div>' +
      (opts.footerHtml ? '<div class="modal-footer">' + opts.footerHtml + '</div>' : '') +
    '</div>';
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  backdrop.querySelector('.modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', escHandlerForModal);
  if (opts.onMount) opts.onMount(backdrop);
  return backdrop;
}
function closeModal() {
  const el = document.getElementById('activeModalBackdrop');
  if (!el) return;
  el.classList.remove('open');
  document.removeEventListener('keydown', escHandlerForModal);
  setTimeout(() => el.remove(), 200);
}

// ---------------- Client-side pagination ----------------
// items are already-loaded rows; pageSize rows are rendered at a time via
// renderPageFn(pageItems, startIndex) into containerEl (a dedicated element
// separate from the table body, holding just the Назад/Вперёд controls).
function paginate(items, pageSize, containerEl, renderPageFn) {
  let page = 1;
  const totalPages = () => Math.max(1, Math.ceil(items.length / pageSize));
  function render() {
    page = Math.min(Math.max(1, page), totalPages());
    const start = (page - 1) * pageSize;
    renderPageFn(items.slice(start, start + pageSize), start);
    containerEl.innerHTML =
      '<div class="pagination">' +
        '<button type="button" class="pagination-btn" data-act="prev"' + (page <= 1 ? ' disabled' : '') + '>Назад</button>' +
        '<span class="pagination-info">Стр. ' + page + ' из ' + totalPages() + '</span>' +
        '<button type="button" class="pagination-btn" data-act="next"' + (page >= totalPages() ? ' disabled' : '') + '>Вперёд</button>' +
      '</div>';
    const prevBtn = containerEl.querySelector('[data-act="prev"]');
    const nextBtn = containerEl.querySelector('[data-act="next"]');
    if (prevBtn) prevBtn.addEventListener('click', () => { page--; render(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { page++; render(); });
  }
  render();
  return { goTo: (p) => { page = p; render(); }, refresh: render };
}

// ---------------- Date-range helper ----------------
// Reads two <input type="date"> values; returns {from, to} (plain
// YYYY-MM-DD strings) or null if either is empty or the range is inverted.
function readDateRange(fromId, toId) {
  const fromEl = document.getElementById(fromId);
  const toEl = document.getElementById(toId);
  if (!fromEl || !toEl) return null;
  const from = fromEl.value;
  const to = toEl.value;
  if (!from || !to || from > to) return null;
  return { from, to };
}

// ---------------- Saved filters (#47) ----------------
// Persists the values of the given input/select ids under a page key so a
// user's date range / dropdown choices survive reloads and navigation.
function saveFilterState(key, ids) {
  try {
    const state = {};
    ids.forEach((id) => { const el = document.getElementById(id); if (el) state[id] = el.value; });
    localStorage.setItem('aqba_filter_' + key, JSON.stringify(state));
  } catch {}
}
function restoreFilterState(key, ids) {
  try {
    const raw = localStorage.getItem('aqba_filter_' + key);
    if (!raw) return false;
    const state = JSON.parse(raw);
    let any = false;
    ids.forEach((id) => { const el = document.getElementById(id); if (el && state[id] != null && state[id] !== '') { el.value = state[id]; any = true; } });
    return any;
  } catch { return false; }
}
function clearFilterState(key) {
  try { localStorage.removeItem('aqba_filter_' + key); } catch {}
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
    const me = await api('/api/auth/me');
    currentUserRole = me.role || 'viewer';
    showApp();
    startCommonPolling();
  } catch {
    showLogin();
  }
}

// ---------------- Global quick search / command palette (#46) ----------------
// Client-side navigation aid over the same PAGES list the nav uses (role-
// filtered identically). Purely a UX shortcut — no new data, no server call.
function renderGlobalSearchButton() {
  const headerRight = document.querySelector('.header-right');
  if (!headerRight || document.getElementById('gsearchBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'gsearchBtn';
  btn.type = 'button';
  btn.className = 'theme-toggle gsearch-btn';
  btn.setAttribute('aria-label', 'Поиск по разделам');
  btn.title = 'Поиск (Ctrl+K)';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  headerRight.insertBefore(btn, headerRight.firstChild);
  btn.addEventListener('click', openGlobalSearch);
}

function openGlobalSearch() {
  const pages = PAGES.filter(p => !p.minRole || roleAtLeast(currentUserRole, p.minRole));
  openModal({
    title: 'Поиск по разделам',
    bodyHtml:
      '<input id="gsearchInput" class="gsearch-input" type="text" placeholder="Начните вводить: продажи, гости, склад…" autocomplete="off"/>' +
      '<ul class="gsearch-results" id="gsearchResults"></ul>',
    onMount: (modalEl) => {
      const input = modalEl.querySelector('#gsearchInput');
      const list = modalEl.querySelector('#gsearchResults');
      let active = 0;
      let filtered = pages;
      const render = () => {
        const q = input.value.trim().toLowerCase();
        filtered = q ? pages.filter(p => p.label.toLowerCase().includes(q) || p.short.toLowerCase().includes(q)) : pages;
        if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
        if (!filtered.length) { list.innerHTML = '<li class="gsearch-empty">Ничего не найдено</li>'; return; }
        list.innerHTML = filtered.map((p, i) =>
          '<li class="gsearch-item' + (i === active ? ' active' : '') + '" data-href="' + p.href + '">' +
          '<span class="gs-icon">' + p.icon + '</span><span>' + esc(p.label) + '</span></li>'
        ).join('');
      };
      render();
      input.focus();
      input.addEventListener('input', render);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) window.location.href = filtered[active].href; }
      });
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.gsearch-item');
        if (item) window.location.href = item.dataset.href;
      });
    },
  });
}

// Ctrl/Cmd+K opens the palette from anywhere inside the authenticated app.
if (!window.__gsearchBound) {
  window.__gsearchBound = true;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      const app = document.getElementById('appScreen');
      if (app && !app.classList.contains('hidden')) { e.preventDefault(); openGlobalSearch(); }
    }
  });
}

// ---------------- Language toggle RU/EN (#44) ----------------
// Lightweight i18n: translates the static interface chrome (navigation, page
// titles, buttons, section headers/hints) via a RU→EN dictionary applied over
// the DOM. Dynamic data from iiko (dish names, numbers) stays as-is. Toggling
// persists the choice and reloads so translation re-applies cleanly.
const LANG_KEY = 'aqba_lang';
function getLang() { try { return localStorage.getItem(LANG_KEY) || 'ru'; } catch { return 'ru'; } }
const I18N_EN = {
  // nav
  'Обзор': 'Overview', 'Продажи': 'Sales', 'Меню': 'Menu', 'Филиалы': 'Branches',
  'Оплаты и скидки': 'Payments & discounts', 'Гости': 'Guests', 'Сотрудники': 'Employees',
  'Явки сотрудников': 'Attendance', 'Склад': 'Warehouse', 'Опасные операции': 'Risky operations',
  'Настройки': 'Settings',
  // page titles / header
  'Опасные операции на кассе': 'Risky POS operations', 'Аналитика iikoRMS / iikoServer': 'iikoRMS / iikoServer analytics',
  'Проверка...': 'Checking...', 'Сервер недоступен': 'Server unavailable', 'Выйти': 'Log out', 'Войти': 'Log in',
  // common buttons / controls
  'Применить': 'Apply', 'Сбросить': 'Reset', 'Рассчитать': 'Calculate', 'Экспорт CSV': 'Export CSV',
  'Отмена': 'Cancel', 'Подтвердить': 'Confirm', 'Назад': 'Back', 'Вперёд': 'Next', 'Все сотрудники': 'All employees',
  '7 дней': '7 days', '14 дней': '14 days', '30 дней': '30 days', '90 дней': '90 days',
  // section headers (most visible)
  'Динамика выручки и чеков': 'Revenue & checks trend', 'Средний чек — динамика': 'Average check — trend',
  'Год к году': 'Year over year', 'План / факт': 'Plan / actual', 'Эффективность по сменам': 'Shift efficiency',
  'По дням недели': 'By weekday', 'Активность по часам': 'Hourly activity', 'Топ блюд': 'Top dishes',
  'Аутсайдеры меню': 'Menu laggards', 'Маржинальность блюд': 'Dish margins', 'Повторы блюд в чеке': 'Repeat dishes per check',
  'Причины списаний блюд': 'Write-off reasons', 'Фильтры': 'Filters', 'Журнал явок': 'Attendance log',
  'Аномалии по сменам': 'Shift anomalies', 'Выручка': 'Revenue', 'Чеки': 'Checks', 'Средний чек': 'Average check',
  'Загрузка...': 'Loading...',
  // login
  'Адрес сервера': 'Server address', 'Логин': 'Login', 'Пароль': 'Password',
};
function applyLanguage() {
  if (getLang() !== 'en') return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const p = n.parentNode; if (!p) return;
    if (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE') return;
    const key = n.nodeValue.trim();
    if (key && I18N_EN[key] != null) n.nodeValue = n.nodeValue.replace(key, I18N_EN[key]);
  });
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((el) => {
    ['placeholder', 'title', 'aria-label'].forEach((a) => {
      const v = el.getAttribute(a); if (v && I18N_EN[v.trim()] != null) el.setAttribute(a, I18N_EN[v.trim()]);
    });
  });
  document.documentElement.setAttribute('lang', 'en');
}
function renderLangToggle() {
  const headerRight = document.querySelector('.header-right');
  if (!headerRight || document.getElementById('langToggleBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'langToggleBtn';
  btn.type = 'button';
  btn.className = 'theme-toggle lang-toggle';
  const lang = getLang();
  btn.textContent = lang === 'en' ? 'RU' : 'EN';
  btn.title = lang === 'en' ? 'Переключить на русский' : 'Switch to English';
  headerRight.insertBefore(btn, headerRight.firstChild);
  btn.addEventListener('click', () => {
    try { localStorage.setItem(LANG_KEY, getLang() === 'en' ? 'ru' : 'en'); } catch {}
    window.location.reload();
  });
}

// ---------------- Widget board: pin (#42) + drag-reorder (#43) ----------------
// Turns a grid of tiles (each carrying data-widget) into a personalisable
// board: drag to reorder, star to pin to the front. Order + pins persist per
// board key in localStorage. Purely client-side layout preference.
function pinIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M5 3h14l-2 9H7z"/><path d="M7 12h10"/></svg>';
}
function widgetGetDragAfter(container, x, y) {
  const els = Array.from(container.querySelectorAll('.widget-tile:not(.dragging)'));
  let closest = { dist: Infinity, el: null };
  els.forEach((el) => {
    const box = el.getBoundingClientRect();
    const d = Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2));
    if (d < closest.dist) closest = { dist: d, el };
  });
  if (!closest.el) return null;
  const box = closest.el.getBoundingClientRect();
  const isAfter = x > box.left + box.width / 2 || y > box.top + box.height / 2;
  return isAfter ? closest.el.nextSibling : closest.el;
}
function initWidgetBoard(grid, storageKey) {
  if (!grid) return;
  const tiles = Array.from(grid.children).filter((el) => el.dataset && el.dataset.widget);
  if (!tiles.length) return;
  const byKey = {};
  tiles.forEach((t) => { byKey[t.dataset.widget] = t; });
  const lsKey = 'aqba_board_' + storageKey;
  let state = { order: [], pinned: [] };
  try { const raw = localStorage.getItem(lsKey); if (raw) state = Object.assign(state, JSON.parse(raw)); } catch {}
  const isPinned = (k) => state.pinned.includes(k);
  const save = () => {
    const order = Array.from(grid.children).filter((el) => el.dataset && el.dataset.widget).map((el) => el.dataset.widget);
    try { localStorage.setItem(lsKey, JSON.stringify({ order, pinned: state.pinned })); } catch {}
  };
  function reflow() {
    const cur = Array.from(grid.children).filter((el) => el.dataset && el.dataset.widget).map((el) => el.dataset.widget);
    const pinnedOrdered = state.pinned.filter((k) => byKey[k]);
    const rest = cur.filter((k) => !isPinned(k));
    [...pinnedOrdered, ...rest].forEach((k) => grid.appendChild(byKey[k]));
    tiles.forEach((t) => t.classList.toggle('pinned', isPinned(t.dataset.widget)));
  }
  tiles.forEach((t) => {
    t.setAttribute('draggable', 'true');
    t.classList.add('widget-tile');
    if (!t.querySelector('.widget-pin')) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'widget-pin';
      pin.setAttribute('aria-label', 'Закрепить виджет');
      pin.innerHTML = pinIconSvg();
      t.appendChild(pin);
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = t.dataset.widget;
        state.pinned = isPinned(k) ? state.pinned.filter((x) => x !== k) : [...state.pinned, k];
        reflow();
        save();
      });
    }
    t.addEventListener('dragstart', (e) => { t.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', t.dataset.widget); } catch {} });
    t.addEventListener('dragend', () => { t.classList.remove('dragging'); save(); });
  });
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = grid.querySelector('.widget-tile.dragging');
    if (!dragging) return;
    const after = widgetGetDragAfter(grid, e.clientX, e.clientY);
    if (after == null) grid.appendChild(dragging);
    else grid.insertBefore(dragging, after);
  });
  // apply saved order, then pinned-first
  const saved = state.order && state.order.length ? state.order : tiles.map((t) => t.dataset.widget);
  const seen = new Set();
  saved.forEach((k) => { if (byKey[k]) { grid.appendChild(byKey[k]); seen.add(k); } });
  tiles.forEach((t) => { if (!seen.has(t.dataset.widget)) grid.appendChild(t); });
  reflow();
}

// #49 PWA: register the service worker (offline shell). Best-effort — a
// failure (e.g. served over plain http on an insecure origin) is silent.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

document.addEventListener('DOMContentLoaded', bootShared);
