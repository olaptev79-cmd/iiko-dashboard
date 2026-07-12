require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const IikoClient = require("./iikoClient");
const sessionStore = require("./sessionStore");
const svc = require("./dashboardService");
const { store: userStore, roleAtLeast } = require("./userStore");
const auditLog = require("./auditLog");
const notifier = require("./notifier");
const totp = require("./totp");
const scheduler = require("./scheduler");

const app = express();
const PORT = process.env.PORT || 3001;
const COOKIE_NAME = "aqba_sid";
// The `Secure` cookie flag must match how the app is actually served, not
// just NODE_ENV: browsers silently drop Secure cookies on every request
// that isn't HTTPS. Most self-hosted deployments (Docker on a LAN, a bare
// server IP, etc.) run in NODE_ENV=production over plain HTTP, and tying
// Secure to IS_PROD there breaks every session on the very next page
// navigation (login "works", then immediately bounces back to the login
// screen, which also makes the sidebar/nav disappear). COOKIE_SECURE lets
// an operator opt in explicitly once the app sits behind HTTPS; it
// defaults to false so the common plain-HTTP case works out of the box.
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

// Comma-separated list of allowed origins in production, e.g.
// ALLOWED_ORIGINS=https://dashboard.example.com,https://www.example.com
// If unset, falls back to reflecting the request origin (dev-friendly default).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  helmet({
    // The frontend is served from a separate nginx container/CDN; a strict
    // default CSP would block that setup unless carefully tuned there too,
    // so we keep helmet's other protections (HSTS, no-sniff, frameguard,
    // etc.) and leave CSP to the frontend's own server config.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl / server-to-server
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // dev fallback
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "100kb" })); // dashboard payloads are small; caps request-body DoS
app.use(cookieParser());

// ---- Global rate limiting: caps abuse/DoS across the whole API, on top of
//      the stricter per-IP limit applied to /api/auth/login below. ----
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    max: 120, // generous for normal dashboard polling across 6 pages
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
  })
);

app.use((req, _res, next) => {
  // Never log request bodies here — /api/auth/login carries a plaintext
  // password and must not end up in logs/output.
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: sanitizeError(e.message) });
  }
};

/** Strips anything that looks like it could leak internal details (stack
 *  frames, file paths, credentials echoed back from iiko errors) before
 *  the message reaches the client. */
function sanitizeError(message) {
  if (!message) return "Внутренняя ошибка сервера";
  return String(message)
    .replace(/\/[^\s"']*\.(js|ts):\d+/g, "[internal]")
    .slice(0, 500);
}

function setSessionCookie(res, sid) {
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

/** Requires an authenticated session; attaches req.client / req.sessionMeta. */
function requireAuth(req, res, next) {
  const sid = req.cookies[COOKIE_NAME];
  const session = sessionStore.get(sid);
  if (!session) {
    return res.status(401).json({ error: "not_authenticated" });
  }
  req.client = session.client;
  req.sessionMeta = session.meta;
  next();
}

/** Requires an authenticated session AND a minimum dashboard role (see
 *  userStore.js — this is a DASHBOARD-UI permission, separate from
 *  whatever role the login has inside iiko itself). Must run after
 *  requireAuth (needs req.sessionMeta.login). Denials are logged so the
 *  audit trail / suspicious-activity view can see attempted overreach. */
function requireRole(minRole) {
  return (req, res, next) => {
    const role = userStore.getRole(req.sessionMeta.login);
    if (!roleAtLeast(role, minRole)) {
      auditLog.record({ actingLogin: req.sessionMeta.login, action: "authz_denied", target: req.path, result: "denied", ip: req.ip });
      return res.status(403).json({ error: "Недостаточно прав для этого действия" });
    }
    next();
  };
}

// ---- Simple in-memory rate limiting for login attempts ----
const loginAttempts = new Map(); // ip -> { count, resetAt }
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return next();
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "too_many_attempts", retryAfterMs: entry.resetAt - now });
  }
  entry.count += 1;
  next();
}

// Recipient for suspicious-activity alerts (#34) and the scheduled daily
// summary (#35/#36) — operator/env-configured, same principle as
// notifier.js itself: never a user-suppliable destination.
const ALERT_TELEGRAM_CHAT_ID = process.env.ALERT_TELEGRAM_CHAT_ID || "";
const FAILED_LOGIN_ALERT_THRESHOLD = 5;
const FAILED_LOGIN_ALERT_WINDOW_MS = 15 * 60 * 1000;

/** Fires a Telegram alert once enough recent failures pile up for a login.
 *  Never awaited by callers (best-effort, must never slow down or break the
 *  login response) and never throws. */
function maybeAlertOnFailedLogin(login, ip) {
  if (!ALERT_TELEGRAM_CHAT_ID || !notifier.telegramConfigured()) return;
  auditLog
    .countRecentFailures(login, "login", FAILED_LOGIN_ALERT_WINDOW_MS)
    .then((count) => {
      if (count === FAILED_LOGIN_ALERT_THRESHOLD) {
        // Fires exactly once per burst (only on the threshold-th failure,
        // not every failure after) rather than spamming on every subsequent attempt.
        return notifier.sendTelegram(
          ALERT_TELEGRAM_CHAT_ID,
          `⚠ Подозрительная активность: ${FAILED_LOGIN_ALERT_THRESHOLD} неудачных попыток входа подряд для «${login}» (IP: ${ip}) за последние 15 минут.`
        );
      }
    })
    .catch((e) => console.error("[auth] Не удалось отправить алерт о неудачных входах:", e.message));
}

// ---- Pending two-factor logins ----
// A login whose iiko password check already succeeded but who has TOTP
// enabled (userStore.getTotpSecret) doesn't get a real session cookie yet —
// it waits here, keyed by a random id, holding the ALREADY-VERIFIED
// IikoClient (see sessionStore.createFromClient's doc comment for why that's
// safer than re-storing the raw password). Single-use and short-lived.
const PENDING_TOTP_TTL_MS = 5 * 60 * 1000;
const pendingTotpLogins = new Map(); // pendingId -> { client, login, expiresAt }
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pendingTotpLogins.entries()) {
    if (now > p.expiresAt) pendingTotpLogins.delete(id);
  }
}, 60 * 1000).unref();

function completeLogin(res, req, client, login) {
  const sid = sessionStore.createFromClient(client, login);
  setSessionCookie(res, sid);
  const userRecord = userStore.ensureUser(login);
  auditLog.record({ actingLogin: login, action: "login", result: "ok", ip: req.ip });
  if (ALERT_TELEGRAM_CHAT_ID) scheduler.registerSession(login, client, ALERT_TELEGRAM_CHAT_ID);
  console.log(`[auth] Успешный вход: ${login}@${client.baseUrl}`);
  res.json({ ok: true, url: client.baseUrl, login, role: userRecord.role });
}

// ---------------- Auth routes ----------------

app.post("/api/auth/login", loginRateLimit, async (req, res) => {
  const { url, login, password } = req.body || {};
  if (!url || !login || !password) {
    return res.status(400).json({ error: "url, login and password are required" });
  }
  // IMPORTANT: never log `password` (or the full req.body) anywhere below.
  try {
    const client = new IikoClient(url, login, password);
    await client.verify();
    const totpSecret = userStore.getTotpSecret(login);
    if (totpSecret) {
      const pendingId = crypto.randomBytes(24).toString("hex");
      pendingTotpLogins.set(pendingId, { client, login, expiresAt: Date.now() + PENDING_TOTP_TTL_MS });
      return res.json({ ok: true, requiresTotp: true, pendingId });
    }
    completeLogin(res, req, client, login);
  } catch (e) {
    auditLog.record({ actingLogin: login, action: "login", result: "denied", ip: req.ip });
    maybeAlertOnFailedLogin(login, req.ip);
    console.log(`[auth] Неудачная попытка входа: ${login}@${String(url).slice(0, 60)}`);
    res.status(401).json({ error: sanitizeError(e.message) || "Не удалось авторизоваться на сервере iiko" });
  }
});

const TOTP_CODE_RE = /^\d{6}$/;
app.post("/api/auth/totp-login-verify", loginRateLimit, (req, res) => {
  const { pendingId, code } = req.body || {};
  const pending = pendingId ? pendingTotpLogins.get(pendingId) : null;
  if (!pending || Date.now() > pending.expiresAt) {
    return res.status(401).json({ error: "Сессия входа истекла, попробуйте войти заново" });
  }
  if (!TOTP_CODE_RE.test(String(code || ""))) {
    return res.status(400).json({ error: "Код должен состоять из 6 цифр" });
  }
  const secret = userStore.getTotpSecret(pending.login);
  if (!secret || !totp.verify(code, secret)) {
    auditLog.record({ actingLogin: pending.login, action: "login_totp", result: "denied", ip: req.ip });
    maybeAlertOnFailedLogin(pending.login, req.ip);
    return res.status(401).json({ error: "Неверный код" });
  }
  pendingTotpLogins.delete(pendingId); // single-use
  completeLogin(res, req, pending.client, pending.login);
});

app.post("/api/auth/logout", (req, res) => {
  const sid = req.cookies[COOKIE_NAME];
  const session = sessionStore.get(sid);
  if (session) scheduler.unregisterSession(session.meta.login);
  if (sid) sessionStore.destroy(sid);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const sid = req.cookies[COOKIE_NAME];
  const session = sessionStore.get(sid);
  if (!session) return res.status(401).json({ authenticated: false });
  const role = userStore.getRole(session.meta.login) || "viewer";
  res.json({ authenticated: true, ...session.meta, role });
});

// ---------------- 2FA enrollment (self-service, any authenticated user) ----------------

app.post("/api/auth/totp-setup", requireAuth, async (req, res) => {
  try {
    const secret = totp.generateSecret();
    const uri = totp.keyUri(req.sessionMeta.login, secret);
    const qrDataUrl = await totp.qrDataUrl(uri);
    // Secret is NOT saved yet — only after /totp-confirm proves the user
    // actually scanned it correctly, so nobody can lock themselves out with
    // a botched enrollment.
    res.json({ secret, uri, qrDataUrl });
  } catch (e) {
    res.status(500).json({ error: sanitizeError(e.message) });
  }
});

app.post("/api/auth/totp-confirm", requireAuth, (req, res) => {
  const { secret, code } = req.body || {};
  if (!secret || !TOTP_CODE_RE.test(String(code || ""))) {
    return res.status(400).json({ error: "Укажите секрет и 6-значный код" });
  }
  if (!totp.verify(code, secret)) {
    return res.status(400).json({ error: "Неверный код — проверьте время на телефоне и попробуйте ещё раз" });
  }
  userStore.setTotpSecret(req.sessionMeta.login, secret);
  auditLog.record({ actingLogin: req.sessionMeta.login, action: "totp_enabled", result: "ok", ip: req.ip });
  res.json({ ok: true });
});

app.post("/api/auth/totp-disable", requireAuth, (req, res) => {
  userStore.setTotpSecret(req.sessionMeta.login, null);
  auditLog.record({ actingLogin: req.sessionMeta.login, action: "totp_disabled", result: "ok", ip: req.ip });
  res.json({ ok: true });
});

// ---------------- Dashboard routes (require session) ----------------

/** Clamps the `days` query param to a sane range so a client can't force
 *  an enormous/negative OLAP query (e.g. days=999999999) against the iiko
 *  server behind this dashboard. */
function clampDays(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 366);
}

app.get("/api/health", requireAuth, wrap((r) => svc.getStatus(r.client, r.sessionMeta)));
app.get("/api/dashboard", requireAuth, wrap((r) => svc.getSummary(r.client)));
app.get("/api/chart", requireAuth, wrap((r) => svc.getChart(r.client, clampDays(r.query.days, 7))));
app.get("/api/weekday-breakdown", requireAuth, wrap((r) => svc.getWeekdayBreakdown(r.client, clampDays(r.query.days, 30))));
app.get("/api/hourly-activity", requireAuth, wrap((r) => svc.getHourlyActivity(r.client, clampDays(r.query.days, 7))));
app.get("/api/top-dishes", requireAuth, wrap((r) => svc.getTopDishes(r.client, clampDays(r.query.days, 7))));
app.get("/api/menu-analysis", requireAuth, wrap((r) => svc.getMenuAnalysis(r.client, clampDays(r.query.days, 30))));
app.get("/api/departments", requireAuth, wrap((r) => svc.getDepartments(r.client)));
app.get("/api/branches", requireAuth, wrap((r) => svc.getBranches(r.client, clampDays(r.query.days, 30))));
app.get("/api/payments", requireAuth, wrap((r) => svc.getPayments(r.client, clampDays(r.query.days, 30))));
app.get("/api/order-types", requireAuth, wrap((r) => svc.getOrderTypes(r.client, clampDays(r.query.days, 30))));
app.get("/api/employees/performance", requireAuth, wrap((r) => svc.getEmployeePerformance(r.client, clampDays(r.query.days, 30))));
app.get("/api/employees/directory", requireAuth, wrap((r) => svc.getEmployeeDirectory(r.client)));
app.get("/api/forecast", requireAuth, wrap((r) => svc.getForecast(r.client)));
app.get("/api/warehouse", requireAuth, wrap((r) => svc.getWarehouse(r.client, clampDays(r.query.days, 30))));
app.get("/api/risky-operations", requireAuth, wrap((r) => svc.getRiskyOperations(r.client, clampDays(r.query.days, 30))));

// ---------------- New feature routes ----------------

const LOGIN_RE = /^[\w.@-]{1,64}$/;
const PIN_RE = /^\d{4}$/;
const PASSWORD_MIN_LEN = 6;
const PASSWORD_MAX_LEN = 100;

function validateCredentialsBody(body) {
  const { login, password, passwordConfirm, pin } = body || {};
  const loginTrim = login ? String(login).trim() : "";
  if (loginTrim && !LOGIN_RE.test(loginTrim)) {
    return "Логин может содержать только латинские буквы, цифры и символы . _ - @";
  }
  const hasPw = !!password;
  const hasConfirm = !!passwordConfirm;
  if (hasPw || hasConfirm) {
    if (!hasPw || !hasConfirm) return "Заполните оба поля пароля";
    if (password.length < PASSWORD_MIN_LEN) return `Пароль должен содержать не менее ${PASSWORD_MIN_LEN} символов`;
    if (password.length > PASSWORD_MAX_LEN) return "Пароль слишком длинный";
    if (password !== passwordConfirm) return "Пароли не совпадают";
  }
  if (pin && !PIN_RE.test(String(pin))) return "PIN-код должен состоять ровно из 4 цифр";
  if (!loginTrim && !hasPw && !pin) return "Укажите логин, пароль или PIN-код для сохранения";
  return null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDateRangeParams(from, to, maxDays = 366) {
  if (!from || !to || !ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    return "Укажите даты в формате ГГГГ-ММ-ДД";
  }
  if (from > to) return "Дата начала должна быть раньше даты окончания";
  if ((new Date(to) - new Date(from)) / 86400000 > maxDays) return `Диапазон не может превышать ${maxDays} дней`;
  return null;
}

// Feature: Employee Credentials Editor
app.put(
  "/api/employees/:id/credentials",
  requireAuth,
  (req, res, next) => {
    const err = validateCredentialsBody(req.body);
    if (err) return res.status(400).json({ error: err });
    next();
  },
  wrap((r) =>
    svc.updateEmployeeCredentials(r.client, r.params.id, r.sessionMeta.login, {
      login: (r.body.login || "").trim() || undefined,
      password: r.body.password || undefined,
      pin: r.body.pin || undefined,
    })
  )
);

// Feature: Employee Attendance Log
app.get(
  "/api/employees/attendance",
  requireAuth,
  (req, res, next) => {
    const err = validateDateRangeParams(req.query.from, req.query.to);
    if (err) return res.status(400).json({ error: err });
    if (req.query.employeeId && !/^[\w-]{1,64}$/.test(req.query.employeeId)) {
      return res.status(400).json({ error: "Некорректный идентификатор сотрудника" });
    }
    next();
  },
  wrap((r) => svc.getAttendance(r.client, r.query.from, r.query.to, r.query.employeeId || null))
);

// Feature: Guest Count Analytics
app.get(
  "/api/guests",
  requireAuth,
  (req, res, next) => {
    const { customFrom, customTo } = req.query;
    if (!!customFrom !== !!customTo) return res.status(400).json({ error: "Укажите обе даты своего периода" });
    if (customFrom) {
      const err = validateDateRangeParams(customFrom, customTo);
      if (err) return res.status(400).json({ error: err });
    }
    next();
  },
  wrap((r) => svc.getGuestAnalytics(r.client, r.query.customFrom || null, r.query.customTo || null))
);

// Feature: Average Check Analytics
app.get("/api/average-check", requireAuth, wrap((r) => svc.getAverageCheckAnalytics(r.client)));

// ---------------- Dashboard admin: users/roles + audit log ----------------
// Dashboard-UI permissions only (see userStore.js) — separate from iiko's
// own role model. Every dashboard login gets a viewer/editor/admin role
// here; the very first login ever recorded becomes admin automatically.

app.get(
  "/api/admin/users",
  requireAuth,
  requireRole("admin"),
  wrap(async () => ({ users: userStore.listUsers() }))
);

const ROLE_BODY_RE = /^(viewer|editor|admin)$/;
app.put(
  "/api/admin/users/:login/role",
  requireAuth,
  requireRole("admin"),
  (req, res, next) => {
    if (!ROLE_BODY_RE.test(String(req.body && req.body.role))) {
      return res.status(400).json({ error: "Роль должна быть одной из: viewer, editor, admin" });
    }
    next();
  },
  wrap((r) => {
    userStore.setRole(r.params.login, r.body.role);
    auditLog.record({ actingLogin: r.sessionMeta.login, action: "role_change", target: `${r.params.login} -> ${r.body.role}`, result: "ok", ip: r.ip });
    return { ok: true };
  })
);

app.get(
  "/api/admin/audit-log",
  requireAuth,
  requireRole("admin"),
  wrap(async (r) => ({ events: await auditLog.readRecent(Math.min(parseInt(r.query.limit, 10) || 200, 1000)) }))
);

// CSV export for the top-dishes report (Excel-friendly, UTF-8 BOM + ;-separated).
app.get(
  "/api/export/top-dishes.csv",
  requireAuth,
  async (req, res) => {
    try {
      const days = clampDays(req.query.days, 30);
      const data = await svc.getTopDishes(req.client, days);
      const header = "Блюдо;Категория;Количество;Выручка";
      const rows = data.dishes.map((d) => `${csvEscape(d.name)};${csvEscape(d.category)};${d.amount};${d.revenue}`);
      const csv = "\uFEFF" + [header, ...rows].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="top-dishes-${days}d.csv"`);
      res.send(csv);
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  }
);

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------- Misc ----------------

app.get("/api/ping", (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// ---------------- Graceful shutdown ----------------
// Ensures in-flight requests finish and logs are flushed before the
// container is actually killed on redeploy/restart (SIGTERM from Docker).
const server = app.listen(PORT, () => console.log(`Aqba Dashboard backend запущен на порту ${PORT}`));
scheduler.start();

function shutdown(signal) {
  console.log(`[server] Получен ${signal}, завершаем работу...`);
  server.close(() => {
    console.log("[server] Все соединения закрыты, выход.");
    process.exit(0);
  });
  // Force-exit if close() hangs for too long (e.g. stuck keep-alive sockets).
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
