const https = require("https");

/**
 * Outbound notification abstraction backing #35 (scheduled email summary),
 * #36 (Telegram alerts), and #34 (suspicious-login alerts reuse this too).
 *
 * Deliberately NOT a generic "send to any URL" helper: the destination
 * (Telegram bot token, SMTP server) is fixed at deploy time via environment
 * variables, chosen by the operator — never a user-supplied arbitrary URL.
 * iikoClient.js already has a DNS-level SSRF guard specifically because
 * letting this backend make outbound requests to an attacker-controlled
 * host is a real risk; reusing "send a webhook to any URL the admin types
 * into a form" here would reopen exactly that hole from a second angle.
 * Admins configure *recipients* (a Telegram chat ID, an email address) in
 * the Settings page — never a webhook/callback URL.
 */

const TELEGRAM_API_HOST = "api.telegram.org"; // fixed, not configurable
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

function telegramConfigured() {
  return !!TELEGRAM_BOT_TOKEN;
}

/** Sends a Telegram message via the Bot API. `chatId` is recipient
 *  configuration (who gets notified), not a destination host — the host is
 *  always api.telegram.org. */
function sendTelegram(chatId, text) {
  if (!telegramConfigured()) {
    return Promise.reject(new Error("Telegram-уведомления не настроены (нет TELEGRAM_BOT_TOKEN)"));
  }
  const body = JSON.stringify({ chat_id: chatId, text });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: TELEGRAM_API_HOST,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`Telegram API вернул статус ${res.statusCode}: ${data.slice(0, 300)}`));
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Таймаут запроса к Telegram API")));
    req.write(body);
    req.end();
  });
}

// SMTP sending is intentionally NOT implemented with a hand-rolled socket
// client here — email delivery (auth, STARTTLS, MIME) is exactly the kind
// of thing that should go through an audited library (e.g. nodemailer)
// rather than reinvented. This is a thin, honest stub until that dependency
// is deliberately added, so callers get a clear, non-silent error instead
// of a fake success.
function emailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendEmail(_to, _subject, _body) {
  if (!emailConfigured()) {
    throw new Error("Email-уведомления не настроены (нет SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }
  throw new Error(
    "Отправка email пока не реализована в этой сборке — добавьте зависимость nodemailer и реализуйте sendEmail() в notifier.js"
  );
}

module.exports = { sendTelegram, sendEmail, telegramConfigured, emailConfigured };
