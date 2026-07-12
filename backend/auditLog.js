const fs = require("fs");
const path = require("path");
const readline = require("readline");

/**
 * Single append-only event log backing THREE features at once (see plan):
 * the admin audit-log page (#31), suspicious-login alerting (#34, filters
 * this same stream for repeated failed logins), and the notification bell
 * (#45, an "unread since last check" view over this same stream). Do not
 * add a second logging mechanism for any of those — extend the `action`
 * vocabulary here instead.
 *
 * Format: JSONL (one JSON object per line) — cheap to append, cheap to
 * tail, doesn't require rewriting the whole file like a JSON array would.
 */

const LOG_PATH = process.env.AUDIT_LOG_PATH || path.join(__dirname, "data", "audit.jsonl");
const MAX_LINES_KEPT = 5000; // soft cap so the file can't grow unbounded forever

function append(event) {
  const dir = path.dirname(LOG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  fs.appendFileSync(LOG_PATH, line, { mode: 0o600 });
}

/** Records an event. `result` should be "ok" or "denied"/"error" so the
 *  suspicious-activity view (#34) can filter on it without parsing free text. */
function record({ actingLogin, action, target, result, ip }) {
  try {
    append({ actingLogin: actingLogin || null, action, target: target || null, result: result || "ok", ip: ip || null });
  } catch (e) {
    // Logging must never break the request it's attached to.
    console.error("[auditLog] failed to write:", e.message);
  }
  maybeTrim();
}

let linesSinceTrimCheck = 0;
function maybeTrim() {
  // Cheap heuristic: only actually check/trim the file every ~200 appends,
  // not on every single write.
  linesSinceTrimCheck++;
  if (linesSinceTrimCheck < 200) return;
  linesSinceTrimCheck = 0;
  try {
    const content = fs.readFileSync(LOG_PATH, "utf8");
    const lines = content.split("\n").filter(Boolean);
    if (lines.length > MAX_LINES_KEPT) {
      const trimmed = lines.slice(lines.length - MAX_LINES_KEPT).join("\n") + "\n";
      fs.writeFileSync(LOG_PATH, trimmed, { mode: 0o600 });
    }
  } catch (e) {
    /* file may not exist yet — nothing to trim */
  }
}

/** Reads the most recent `limit` events, newest first. Small/simple
 *  reversal — this file is capped at MAX_LINES_KEPT lines, never huge
 *  enough to justify a streaming reverse-read. */
async function readRecent(limit = 200) {
  let content;
  try {
    content = fs.readFileSync(LOG_PATH, "utf8");
  } catch (e) {
    return [];
  }
  const lines = content.split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Counts failed logins for a given login within the last `windowMs` —
 *  used by #34's suspicious-login alerting. */
async function countRecentFailures(actingLogin, action, windowMs) {
  const events = await readRecent(1000);
  const cutoff = Date.now() - windowMs;
  return events.filter(
    (e) => e.actingLogin === actingLogin && e.action === action && e.result !== "ok" && new Date(e.ts).getTime() >= cutoff
  ).length;
}

module.exports = { record, readRecent, countRecentFailures };
