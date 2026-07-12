const fs = require("fs");
const path = require("path");

/**
 * Persists a CURATED, non-PII snapshot of the top-line dashboard KPIs so that
 * scoped-token consumers (external BI API #40, public read-only link #38,
 * iframe embed #39) can read numbers WITHOUT an iiko session of their own.
 *
 * Why a snapshot at all: the dashboard queries iiko using the logged-in user's
 * in-memory session credentials (never stored on disk). A public link / API
 * key has no such session, so it can't hit iiko directly. Instead, whenever an
 * authenticated user loads their dashboard, we cache the aggregate KPIs here
 * and serve THAT to token holders. Consequences: token consumers see data as
 * fresh as the last dashboard view (possibly stale), and they only ever see a
 * deliberately small, non-sensitive subset — never employee names, never a
 * per-department breakdown, never anything that could identify a person.
 */

const STORE_PATH = process.env.SNAPSHOT_STORE_PATH || path.join(__dirname, "data", "snapshot.json");

// Whitelist of fields allowed into the snapshot. Anything not listed here is
// dropped, so a future change to getSummary() can't accidentally leak a new
// field to public consumers.
function curate(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    revenue: Number(summary.revenue) || 0,
    orders: Number(summary.orders) || 0,
    avgCheck: Number(summary.avgCheck) || 0,
    guests: Number(summary.guests) || 0,
  };
}

function set(summary) {
  const kpis = curate(summary);
  if (!kpis) return;
  const payload = { updatedAt: new Date().toISOString(), kpis };
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STORE_PATH);
  } catch {
    /* snapshot is best-effort; a write failure must never break the dashboard */
  }
}

function get() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return null;
  }
}

module.exports = { set, get, curate };
