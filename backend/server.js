require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const IikoClient = require("./iikoClient");
const sessionStore = require("./sessionStore");
const svc = require("./dashboardService");

const app = express();
const PORT = process.env.PORT || 3001;
const COOKIE_NAME = "aqba_sid";
const IS_PROD = process.env.NODE_ENV === "production";

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
};

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
  try {
    const client = new IikoClient(url, login, password);
    await client.verify();
    const sid = sessionStore.create(url, login, password);
    setSessionCookie(res, sid);
    res.json({ ok: true, url: client.baseUrl, login });
  } catch (e) {
    res.status(401).json({ error: e.message || "Не удалось авторизоваться на сервере iiko" });
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

app.get("/api/health", requireAuth, wrap((r) => svc.getStatus(r.client, r.sessionMeta)));
app.get("/api/dashboard", requireAuth, wrap((r) => svc.getSummary(r.client)));
app.get("/api/chart", requireAuth, wrap((r) => svc.getChart(r.client, Number(r.query.days) || 7)));
app.get("/api/top-dishes", requireAuth, wrap((r) => svc.getTopDishes(r.client, Number(r.query.days) || 7)));
app.get("/api/departments", requireAuth, wrap((r) => svc.getDepartments(r.client)));
app.get("/api/branches", requireAuth, wrap((r) => svc.getBranches(r.client, Number(r.query.days) || 30)));
app.get("/api/forecast", requireAuth, wrap((r) => svc.getForecast(r.client)));

// ---------------- Misc ----------------

app.get("/api/ping", (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.listen(PORT, () => console.log(`Aqba Dashboard backend запущен на порту ${PORT}`));
