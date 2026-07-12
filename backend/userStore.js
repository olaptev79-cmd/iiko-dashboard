const fs = require("fs");
const path = require("path");

/**
 * Dashboard-own user/role store — the first persisted data in this app.
 *
 * IMPORTANT distinction from iiko credentials: this store never holds an
 * iiko password. It only remembers, per iiko login, which ROLE that login
 * has *inside this dashboard's own UI* (viewer/editor/admin) and an
 * optional TOTP secret for the dashboard's own 2FA. The real iiko password
 * is still re-verified against iiko on every login (see server.js) — this
 * store cannot grant iiko access by itself, only dashboard-UI permissions.
 * That keeps it out of the "never persist iiko credentials" guarantee the
 * rest of the app relies on (sessionStore.js), while still being sensitive
 * enough (TOTP secrets) to deserve careful file handling below.
 *
 * Persistence: a single JSON file, written atomically (tmp file + rename,
 * so a crash mid-write can never leave a half-written/corrupt file).
 */

const ROLES = ["viewer", "editor", "admin"];
const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 };

const STORE_PATH = process.env.USER_STORE_PATH || path.join(__dirname, "data", "users.json");

function roleAtLeast(role, min) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[min] ?? Infinity);
}

class UserStore {
  constructor(storePath) {
    this.storePath = storePath;
    this.users = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.storePath, "utf8");
      return JSON.parse(raw);
    } catch (e) {
      return {}; // missing/corrupt file -> start empty, first login bootstraps admin
    }
  }

  _save() {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.users, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.storePath); // atomic on the same filesystem
  }

  /** Ensures a user record exists for this iiko login. The very first
   *  record ever created becomes admin (so there's always at least one
   *  admin without a manual bootstrap step); every subsequent new login
   *  starts as viewer until an existing admin promotes them. Returns the
   *  (possibly newly-created) record. */
  ensureUser(login) {
    if (this.users[login]) {
      this.users[login].lastLoginAt = new Date().toISOString();
      this._save();
      return this.users[login];
    }
    const isFirstEver = Object.keys(this.users).length === 0;
    const record = {
      role: isFirstEver ? "admin" : "viewer",
      totpSecret: null,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    this.users[login] = record;
    this._save();
    return record;
  }

  getRole(login) {
    return this.users[login] ? this.users[login].role : null;
  }

  /** Sets another user's role. Caller (server.js route) is responsible for
   *  checking the ACTING user is an admin before calling this. */
  setRole(login, role) {
    if (!ROLES.includes(role)) throw new Error(`Неизвестная роль: ${role}`);
    if (!this.users[login]) throw new Error("Пользователь дашборда не найден (ещё не входил в систему)");
    this.users[login].role = role;
    this._save();
  }

  setTotpSecret(login, secret) {
    if (!this.users[login]) throw new Error("Пользователь дашборда не найден");
    this.users[login].totpSecret = secret;
    this._save();
  }

  getTotpSecret(login) {
    return this.users[login] ? this.users[login].totpSecret : null;
  }

  /** Listing never exposes totpSecret. */
  listUsers() {
    return Object.entries(this.users).map(([login, u]) => ({
      login,
      role: u.role,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      totpEnabled: !!u.totpSecret,
    }));
  }
}

const store = new UserStore(STORE_PATH);

module.exports = { store, ROLES, roleAtLeast };
