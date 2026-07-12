const notifier = require("./notifier");

/**
 * Scheduled Telegram summary (#35/#36 from the feature list). Deliberately
 * does NOT hold its own iiko session/credentials — it can only notify about
 * whichever session(s) are already logged into the dashboard when a tick
 * fires (this app has no standing iiko credentials of its own; see
 * sessionStore.js's in-memory-only design). `registerSession`/
 * `unregisterSession` let server.js tell the scheduler which live
 * IikoClient + chat id to use; if none are registered, ticks are silent
 * no-ops rather than errors.
 */

let dashboardServiceRef = null; // lazy require to avoid a circular require at module load time
function svc() {
  if (!dashboardServiceRef) dashboardServiceRef = require("./dashboardService");
  return dashboardServiceRef;
}

// login -> { client, chatId }
const registered = new Map();

function registerSession(login, client, chatId) {
  if (!chatId) return; // nothing to notify without a configured recipient
  registered.set(login, { client, chatId });
}

function unregisterSession(login) {
  registered.delete(login);
}

async function runDailySummaryTick() {
  if (!notifier.telegramConfigured() || registered.size === 0) return;
  for (const [login, { client, chatId }] of registered.entries()) {
    try {
      const summary = await svc().getSummary(client);
      const text =
        `Сводка за ${summary.date} (${login})\n` +
        `Выручка: ${summary.revenue} ₽\n` +
        `Чеки: ${summary.orders}\n` +
        `Средний чек: ${summary.avgCheck} ₽`;
      await notifier.sendTelegram(chatId, text);
    } catch (e) {
      console.error(`[scheduler] Не удалось отправить сводку для ${login}:`, e.message);
    }
  }
}

let intervalHandle = null;

/** Starts the daily-tick timer. Interval is deliberately short-checked
 *  (every hour) rather than computing an exact "next midnight" delay —
 *  simpler, and `lastRunDate` guards against sending more than once per
 *  calendar day regardless of how often the tick itself fires. */
let lastRunDate = null;
function start() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today === lastRunDate) return;
    lastRunDate = today;
    runDailySummaryTick();
  }, 60 * 60 * 1000);
  intervalHandle.unref();
}

module.exports = { start, registerSession, unregisterSession, runDailySummaryTick };
