require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const IikoClient = require("./iikoClient");
const sessionStore = require("./sessionStore");
const svc = require("./dashboardService");

const app = express();
const PORT = process.env.PORT || 3001;
const COOKIE_NAME = "aqba_sid";
const IS_PROD = process.env.NODE_ENV === "production";

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
    secure: IS_PROD,
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
    const sid = sessionStore.create(url, login, password);
    setSessionCookie(res, sid);
    console.log(`[auth] Успешный вход: ${login}@${client.baseUrl}`);
    res.json({ ok: true, url: client.baseUrl, login });
  } catch (e) {
    console.log(`[auth] Неудачная попытка входа: ${login}@${String(url).slice(0, 60)}`);
    res.status(401).json({ error: sanitizeError(e.message) || "Не удалось авторизоваться на сервере iiko" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const sid = req.cookies[COOKIE_NAME];
  if (sid) sessionStore.destroy(sid);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const sid = req.cookies[COOKIE_NAME];
  const session = sessionStore.get(sid);
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, ...session.meta });
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
