const crypto = require("crypto");
const IikoClient = require("./iikoClient");

/**
 * In-memory registry: sessionId -> { client, meta, lastAccess }
 * Sessions expire after SESSION_TTL_MS of inactivity.
 */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

class SessionStore {
  constructor() {
    this.sessions = new Map();
    setInterval(() => this.cleanup(), 15 * 60 * 1000).unref();
  }

  cleanup() {
    const now = Date.now();
    for (const [id, s] of this.sessions.entries()) {
      if (now - s.lastAccess > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }

  create(url, login, password) {
    const id = crypto.randomBytes(24).toString("hex");
    const client = new IikoClient(url, login, password);
    this.sessions.set(id, {
      client,
      meta: { url: client.baseUrl, login },
      lastAccess: Date.now(),
    });
    return id;
  }

  get(id) {
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.lastAccess > SESSION_TTL_MS) {
      this.sessions.delete(id);
      return null;
    }
    s.lastAccess = Date.now();
    return s;
  }

  destroy(id) {
    this.sessions.delete(id);
  }
}

module.exports = new SessionStore();
