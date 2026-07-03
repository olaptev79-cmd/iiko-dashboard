const crypto = require("crypto");
const IikoClient = require("./iikoClient");

/**
 * Registry: sessionId -> { client, meta, lastAccess }
 * Sessions expire after SESSION_TTL_MS of inactivity.
 *
 * Security: sessions are kept ONLY in memory. Credentials (login/password)
 * are never written to disk in any form (plaintext or encrypted) — an app
 * restart/redeploy simply logs everyone out and they sign in again. This
 * trades a small UX inconvenience (re-login after deploys) for the
 * guarantee that a compromised disk/backup can never leak iiko passwords.
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
    const id = crypto.randomBytes(32).toString("hex");
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

  /** Number of currently active (non-expired) sessions — used for basic diagnostics. */
  activeCount() {
    return this.sessions.size;
  }
}

module.exports = new SessionStore();
