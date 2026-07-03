const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const IikoClient = require("./iikoClient");

/**
 * Registry: sessionId -> { client, meta, lastAccess }
 * Sessions expire after SESSION_TTL_MS of inactivity.
 *
 * Persistence: session credentials (url/login/password) are mirrored to a
 * local JSON file so an app restart/redeploy does not force every logged-in
 * user to re-enter their iiko credentials. The IikoClient instances
 * themselves (and their in-memory auth tokens) are NOT serializable and are
 * always rebuilt on load — only the re-auth material is persisted.
 */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const DATA_DIR = process.env.SESSION_STORE_DIR || path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "sessions.json");

class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.load();
    setInterval(() => this.cleanup(), 15 * 60 * 1000).unref();
  }

  load() {
    try {
      if (!fs.existsSync(STORE_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      const now = Date.now();
      let restored = 0;
      for (const [id, s] of Object.entries(raw)) {
        if (!s || now - s.lastAccess > SESSION_TTL_MS) continue;
        const client = new IikoClient(s.meta.url, s.meta.login, s.password);
        this.sessions.set(id, { client, meta: s.meta, lastAccess: s.lastAccess, password: s.password });
        restored += 1;
      }
      if (restored > 0) console.log(`[sessionStore] Восстановлено активных сессий: ${restored}`);
    } catch (e) {
      console.error("[sessionStore] Не удалось загрузить сохранённые сессии:", e.message);
    }
  }

  persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const out = {};
      for (const [id, s] of this.sessions.entries()) {
        out[id] = { meta: s.meta, password: s.password, lastAccess: s.lastAccess };
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(out), { mode: 0o600 });
    } catch (e) {
      console.error("[sessionStore] Не удалось сохранить сессии на диск:", e.message);
    }
  }

  cleanup() {
    const now = Date.now();
    let changed = false;
    for (const [id, s] of this.sessions.entries()) {
      if (now - s.lastAccess > SESSION_TTL_MS) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  create(url, login, password) {
    const id = crypto.randomBytes(24).toString("hex");
    const client = new IikoClient(url, login, password);
    this.sessions.set(id, {
      client,
      meta: { url: client.baseUrl, login },
      password,
      lastAccess: Date.now(),
    });
    this.persist();
    return id;
  }

  get(id) {
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.lastAccess > SESSION_TTL_MS) {
      this.sessions.delete(id);
      this.persist();
      return null;
    }
    s.lastAccess = Date.now();
    return s;
  }

  destroy(id) {
    if (this.sessions.delete(id)) this.persist();
  }
}

module.exports = new SessionStore();
