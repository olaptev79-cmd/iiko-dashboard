const otplib = require("otplib");
const QRCode = require("qrcode");

/**
 * Thin wrapper around otplib v13's options-heavy functional API (each call
 * needs an explicit {secret, digits, period, algorithm} object, and
 * verifySync THROWS on malformed input like a wrong-length token instead of
 * returning false) — this file is the one place that knows those details,
 * so server.js just calls simple functions.
 */

const OPTS = { digits: 6, period: 30, algorithm: "SHA1" };
const CODE_RE = /^\d{6}$/;

function generateSecret() {
  return otplib.generateSecret();
}

function keyUri(login, secret) {
  return otplib.generateURI({ secret, label: login, issuer: "Aqba Dashboard" });
}

async function qrDataUrl(uri) {
  return QRCode.toDataURL(uri, { margin: 1, width: 240 });
}

/** Returns true/false — never throws, even for malformed `code` input
 *  (otplib's verifySync throws TokenLengthError/TokenFormatError for
 *  anything that isn't exactly 6 digits, which would otherwise crash the
 *  request handler on a simple typo). */
function verify(code, secret) {
  if (!CODE_RE.test(String(code || ""))) return false;
  try {
    return !!otplib.verifySync({ token: String(code), secret, ...OPTS }).valid;
  } catch (e) {
    return false;
  }
}

module.exports = { generateSecret, keyUri, qrDataUrl, verify };
