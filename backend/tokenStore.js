const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Scoped, revocable, expiring access tokens — backs three later features
 * (public read-only report links, iframe embed, external BI API key). Built
 * once here so those three differ only in HOW the token is transmitted
 * (URL param / iframe query-string / Authorization header), not in three
 * separate token implementations.
 *
 * Tokens are never stored in plaintext: only sha256(token) is persisted, so
 * reading this file can't hand out working tokens. The plaintext value is
 * returned exactly once, at creation time, same convention as e.g. GitHub
 * personal access tokens.
 */

const STORE_PATH = process.env.TOKEN_STORE_PATH || path.join(__dirname, "data", "tokens.json");

function hash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

class TokenStore {
  constructor(storePath) {
    this.storePath = storePath;
    this.tokens = this._load(); // hash -> { scope, createdBy, createdAt, expiresAt, revoked, lastUsedAt, label }
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.storePath, "utf8"));
    } catch {
      return {};
    }
  }

  _save() {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.storePath);
  }

  /** Creates a new token. Returns the ONE-TIME plaintext value — callers
   *  must show it to the admin immediately and never persist it themselves. */
  create({ scope, createdBy, label, ttlMs }) {
    const plaintext = crypto.randomBytes(32).toString("base64url");
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;
    this.tokens[hash(plaintext)] = {
      scope,
      createdBy,
      label: label || "",
      createdAt: new Date().toISOString(),
      expiresAt,
      revoked: false,
      lastUsedAt: null,
    };
    this._save();
    return plaintext;
  }

  /** Validates a presented plaintext token against the required scope.
   *  Returns the token record on success, or null if missing/expired/revoked/
   *  wrong scope — callers should treat null as a generic 401/403, never
   *  reveal WHY it failed (don't distinguish "expired" from "revoked" from
   *  "never existed" to the caller). */
  validate(plaintext, requiredScope) {
    if (!plaintext) return null;
    const rec = this.tokens[hash(plaintext)];
    if (!rec) return null;
    if (rec.revoked) return null;
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now()) return null;
    if (rec.scope !== requiredScope) return null;
    rec.lastUsedAt = new Date().toISOString();
    this._save();
    return rec;
  }

  /** Lists tokens for an admin UI. Never returns the plaintext (it's not
   *  stored) or the hash (no reason to expose it) — just metadata. */
  list() {
    return Object.entries(this.tokens).map(([tokenHash, rec]) => ({
      id: tokenHash.slice(0, 12), // short, non-reversible id for the UI/revoke calls
      scope: rec.scope,
      label: rec.label,
      createdBy: rec.createdBy,
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
      revoked: rec.revoked,
      lastUsedAt: rec.lastUsedAt,
    }));
  }

  revokeById(shortId) {
    const fullHash = Object.keys(this.tokens).find((h) => h.startsWith(shortId));
    if (!fullHash) return false;
    this.tokens[fullHash].revoked = true;
    this._save();
    return true;
  }
}

const store = new TokenStore(STORE_PATH);

module.exports = { store };
