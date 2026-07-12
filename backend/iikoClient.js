const axios = require("axios");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");

function sha1(str) {
  return crypto.createHash("sha1").update(str).digest("hex");
}

function normalizeUrl(raw) {
  let url = String(raw || "").trim().replace(/\/$/, "");
  if (url && !/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url;
}

/**
 * SSRF guard: the iiko server URL is entirely user-supplied, so without
 * validation a malicious/careless user could point this backend at
 * internal infrastructure (localhost, private RFC1918 ranges, link-local
 * cloud metadata endpoints like 169.254.169.254, etc.) and use it as a
 * blind request proxy. We resolve the hostname to its actual IP(s) and
 * reject anything private/loopback/link-local/reserved before any
 * request is made — this also defeats DNS-rebinding since axios reuses
 * this same resolution behaviour is not guaranteed, so callers should
 * treat this as a best-effort gate at connection time, re-checked on
 * every new client (i.e. every login).
 */
function isDisallowedIp(ip) {
  const type = net.isIP(ip);
  if (!type) return true; // not a valid IP at all — reject
  if (type === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded IPv4 address too
    return isDisallowedIp(lower.replace("::ffff:", ""));
  }
  return false;
}

/** Fast, synchronous pre-check for the obvious case, done before any DNS
 *  lookup or network call — the http(s) Agent's `lookup` override (wired
 *  up in the constructor below) is the real enforcement point that covers
 *  every request and every hostname, including DNS-rebinding attempts. */
function rejectObviousLocalHost(baseUrl) {
  let hostname;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error("Некорректный адрес сервера iiko");
  }
  if (!hostname) throw new Error("Некорректный адрес сервера iiko");
  if (hostname === "localhost" || hostname === "0.0.0.0") {
    throw new Error("Адрес сервера не может указывать на localhost");
  }
  if (net.isIP(hostname) && isDisallowedIp(hostname)) {
    throw new Error("Адрес сервера указывает на запрещённый/внутренний IP");
  }
}

class IikoClient {
  constructor(baseUrl, login, password) {
    this.baseUrl = normalizeUrl(baseUrl);
    rejectObviousLocalHost(this.baseUrl);
    this.login = login;
    this.password = password;
    this.token = null;
    this.tokenExpiry = null;
    // SSRF hardening: force every single TCP connection this client ever
    // makes to go through our own DNS lookup, which rejects private/
    // loopback/link-local/reserved IPs. Passed via the http(s) Agent's own
    // `lookup` option (the actual Node knob for this), not axios directly.
    // This closes the DNS-rebinding gap that a one-time check-then-connect
    // validation would leave open (the attacker's DNS could resolve to a
    // safe IP during the initial check and to an internal IP a moment
    // later, at actual connection time).
    const safeLookup = (hostname, options, callback) => {
      dns
        .lookup(hostname, { all: true, verbatim: true })
        .then((records) => {
          const safe = records.filter((r) => !isDisallowedIp(r.address));
          if (!safe.length) {
            callback(new Error("Запрос к внутреннему/запрещённому адресу заблокирован"));
            return;
          }
          // Node's http/https Agent calls this `lookup` option with
          // `options.all: true` for Happy Eyeballs (dual-stack) connection
          // attempts (default since Node 20). In that mode it expects the
          // callback as `(err, addresses[])` — an ARRAY of {address,family}
          // — not the classic single-address `(err, address, family)` form.
          // Always using the single-address form breaks every request with
          // a cryptic "Invalid IP address: undefined" once Node passes
          // `all: true`, which is exactly the case that matters here.
          if (options && options.all) {
            callback(null, safe);
          } else {
            const pick = safe[0];
            callback(null, pick.address, pick.family);
          }
        })
        .catch((e) => callback(e));
    };
    this.http = axios.create({
      timeout: 15000,
      validateStatus: () => true,
      httpAgent: new http.Agent({ lookup: safeLookup }),
      httpsAgent: new https.Agent({ lookup: safeLookup }),
    });
  }

  normalizeToken(data) {
    if (!data) return null;
    if (typeof data === "string") return data.trim();
    if (typeof data === "object") {
      if (typeof data.key === "string") return data.key.trim();
      if (typeof data.token === "string") return data.token.trim();
      if (typeof data.authToken === "string") return data.authToken.trim();
      if (typeof data.session === "string") return data.session.trim();
      if (typeof data.value === "string") return data.value.trim();
    }
    return null;
  }

  async requestTokenFrom(url, options = {}) {
    const res = await this.http.request({ url, ...options });
    if (res.status >= 200 && res.status < 300) {
      const token = this.normalizeToken(res.data);
      if (token) return token;
      throw new Error(`Auth endpoint returned success but no token: ${url}`);
    }
    throw new Error(`Auth failed ${res.status} for ${url}`);
  }

  async getToken() {
    const now = Date.now();
    if (this.token && this.tokenExpiry && now < this.tokenExpiry) {
      return this.token;
    }

    // iiko requires SHA1 hash of the password
    const passHash = sha1(this.password);

    const attempts = [
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "get",
          params: { login: this.login, pass: passHash },
        }),
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "get",
          params: { login: this.login, password: passHash },
        }),
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "post",
          headers: { "Content-Type": "application/json" },
          data: { login: this.login, pass: passHash },
        }),
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "post",
          headers: { "Content-Type": "application/json" },
          data: { login: this.login, password: passHash },
        }),
    ];

    const errors = [];
    for (const attempt of attempts) {
      try {
        const token = await attempt();
        this.token = token;
        this.tokenExpiry = Date.now() + 50 * 60 * 1000;
        console.log("[iiko] Token acquired");
        return token;
      } catch (e) {
        errors.push(e.message);
      }
    }

    throw new Error(`Unable to authorize in iiko. Tried auth variants: ${errors.join(" | ")}`);
  }

  async apiGet(path, params = {}, retry = true) {
    const key = await this.getToken();
    const res = await this.http.get(`${this.baseUrl}/resto/api/${path}`, {
      params: { key, ...params },
    });
    if (res.status >= 200 && res.status < 300) {
      return res.data;
    }
    if (res.status === 401 && retry) {
      this.token = null;
      this.tokenExpiry = null;
      return this.apiGet(path, params, false);
    }
    throw new Error(`GET /resto/api/${path} failed with status ${res.status}`);
  }

  async olapPost(body, retry = true) {
    const key = await this.getToken();
    const res = await this.http.post(
      `${this.baseUrl}/resto/api/v2/reports/olap`,
      body,
      {
        params: { key },
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      }
    );
    if (res.status >= 200 && res.status < 300) {
      const rows = res.data && Array.isArray(res.data.data) ? res.data.data.length : "n/a";
      console.log(
        "[iiko] OLAP ok. Rows:", rows,
        "| Filters:", JSON.stringify(body.filters)
      );
      return res.data;
    }
    if (res.status === 401 && retry) {
      this.token = null;
      this.tokenExpiry = null;
      return this.olapPost(body, false);
    }
    const details = this.describeError(res.data);
    console.error(
      `[iiko] OLAP request failed (${res.status}). Request body: ${JSON.stringify(body)}. Response: ${details}`
    );
    throw new Error(
      `POST /resto/api/v2/reports/olap failed with status ${res.status}: ${details}`
    );
  }

  describeError(data) {
    if (data == null) return "<empty body>";
    if (typeof data === "string") return data;
    if (typeof data === "object") {
      if (typeof data.message === "string") return data.message;
      if (typeof data.error === "string") return data.error;
      try {
        return JSON.stringify(data);
      } catch (e) {
        return String(data);
      }
    }
    return String(data);
  }

  // iiko v2 OLAP already returns `data` as an array of ready-made row
  // objects keyed by field name (e.g. { Department, DishSumInt, ... }) -
  // there is no separate columnNames array to zip against, unlike the
  // legacy tabular OLAP v1 format this code was originally written for.
  parseOlap(data) {
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map((row) => {
      const obj = {};
      Object.keys(row || {}).forEach((c) => {
        obj[c] = row[c];
      });
      return obj;
    });
  }

  async getDepartments() {
    return this.apiGet("corporation/departments");
  }

  async getTerminals() {
    return this.apiGet("corporation/terminals");
  }

  async getEmployees() {
    return this.apiGet("employees");
  }

  /** Redacts a sensitive value out of an error/log string before it's ever
   *  thrown/logged/returned to the client — guards against iiko's own error
   *  responses accidentally echoing back a submitted password/PIN (e.g. a
   *  validation message like "invalid password: ..."). */
  redactSensitive(text, ...secrets) {
    let out = String(text == null ? "" : text);
    secrets.forEach((s) => {
      if (s && String(s).length >= 3) {
        out = out.split(String(s)).join("[скрыто]");
      }
    });
    return out;
  }

  /** Upserts an employee record in iiko. The exact endpoint/payload shape
   *  for editing an employee's login/password/PIN is NOT confirmed against
   *  a live iiko server in this codebase — this tries the conventional
   *  iikoServer RMS path first, then a plausible fallback, mirroring the
   *  same multi-variant approach getToken() already uses for /resto/api/auth.
   *  `secrets` (password/PIN values) are redacted from any error text before
   *  it is ever thrown, logged, or returned to the client. */
  async saveEmployee(payload, secrets = []) {
    const key = await this.getToken();
    const attempts = [
      { method: "post", url: `${this.baseUrl}/resto/api/employees/save` },
      { method: "post", url: `${this.baseUrl}/resto/api/employees` },
    ];
    const errors = [];
    for (const a of attempts) {
      try {
        const res = await this.http.request({
          method: a.method,
          url: a.url,
          params: { key },
          headers: { "Content-Type": "application/json" },
          data: payload,
          timeout: 20000,
        });
        if (res.status >= 200 && res.status < 300) return res.data;
        errors.push(`${a.method.toUpperCase()} ${a.url} -> ${res.status}: ${this.describeError(res.data)}`);
      } catch (e) {
        errors.push(`${a.method.toUpperCase()} ${a.url} -> ${e.message}`);
      }
    }
    const message = this.redactSensitive(
      `Не удалось сохранить сотрудника в iiko. Попробованные варианты: ${errors.join(" | ")}`,
      ...secrets
    );
    throw new Error(message);
  }

  /** Fetches employee attendance (clock-in/clock-out) records. The exact
   *  endpoint/response shape is NOT confirmed against a live iiko server —
   *  tries a couple of plausible candidates and surfaces whatever error iiko
   *  actually returns so a mismatch is diagnosable rather than silent. If
   *  the real endpoint returns XML instead of JSON, this will need an XML
   *  parsing fallback that can't be written without seeing a live response. */
  async getAttendance(from, to) {
    const key = await this.getToken();
    const attempts = [
      { url: `${this.baseUrl}/resto/api/employees/attendance`, params: { key, from, to } },
      { url: `${this.baseUrl}/resto/api/employees/attendance.xml`, params: { key, from, to } },
    ];
    const errors = [];
    for (const a of attempts) {
      try {
        const res = await this.http.get(a.url, {
          params: a.params,
          headers: { Accept: "application/json" },
          timeout: 20000,
        });
        if (res.status >= 200 && res.status < 300) return res.data;
        errors.push(`${a.url} -> ${res.status}: ${this.describeError(res.data)}`);
      } catch (e) {
        errors.push(`${a.url} -> ${e.message}`);
      }
    }
    throw new Error(`Не удалось получить явки из iiko. Попробованные варианты: ${errors.join(" | ")}`);
  }

  // iiko v2 OLAP report filters of type DATE reject any time component —
  // the server responds with HTTP 409 ("в периоде типа DATE указано время")
  // if from/to include a time-of-day. Always send plain "yyyy-MM-dd".
  normalizeOlapDate(value) {
    if (!value) return value;
    return String(value).trim().slice(0, 10);
  }

  // Half-open interval: "to" is EXCLUSIVE (the day after the last day
  // wanted). Callers pass an already-exclusive "to" (see dashboardService's
  // todayRange/daysRange). includeHigh must be false or iiko rejects
  // ranges where the computed span looks like a single-point date.
  dateRangeFilter(from, to) {
    return {
      filterType: "DateRange",
      periodType: "CUSTOM",
      from: this.normalizeOlapDate(from),
      to: this.normalizeOlapDate(to),
      includeLow: true,
      includeHigh: false,
    };
  }

  async getOlapSales(from, to, extraAggregateFields = []) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["OpenDate.Typed", "Department.Id", "Department"],
      aggregateFields: ["DishAmountInt", "DishSumInt", ...extraAggregateFields],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  async getOlapTopDishes(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["DishName", "DishGroup"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Per-dish sales plus a dynamically-discovered cost-price field (name
   *  varies per install — resolved via getSalesColumns()+pickField() by the
   *  caller). Powers the dish-margin (price vs cost) report (#14). */
  async getOlapDishCost(from, to, costField) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["DishName", "DishGroup"],
      aggregateFields: ["DishAmountInt", "DishSumInt", costField].filter(Boolean),
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Sales grouped by order-identifier + dish, to find dishes ordered more
   *  than once within a single order (#7). `orderField` is discovered per
   *  install; if that install won't let it be grouped, olapPost throws and
   *  the caller degrades to { available:false }. */
  async getOlapDishRepeats(from, to, orderField) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: [orderField, "DishName"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Per-dish sales split by day, for demand-variability (XYZ) analysis (#2). */
  async getOlapDishByDate(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: ["DishName", "OpenDate.Typed"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Sales grouped by cashier + hour of day, for the register heatmap (#5).
   *  `cashierField` is resolved dynamically by the caller. */
  async getOlapCashierHourly(from, to, cashierField) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields: [cashierField, "HourOpen"],
      aggregateFields: ["DishSumInt", "DishAmountInt"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Sales grouped by hour of day (0-23) — powers the hourly activity heatmap. */
  async getOlapHourly(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["OpenDate.Typed", "HourOpen"],
      aggregateFields: ["DishAmountInt", "DishSumInt", "UniqOrderId"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Sales grouped by payment type (cash / card / other) and discounts. */
  async getOlapPayments(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["PayTypes"],
      aggregateFields: ["DishSumInt", "DishDiscountSumInt", "DishAmountInt"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Sales grouped by order type (dine-in / delivery / takeaway if available). */
  async getOlapOrderTypes(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["OrderType", "DeletedWithWriteoff"],
      aggregateFields: ["DishSumInt", "DishAmountInt"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Sales grouped by dish category for menu/ABC analysis, incl. discounts. */
  async getOlapDishGroups(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["DishGroup", "DishCategory"],
      aggregateFields: ["DishAmountInt", "DishSumInt", "DishDiscountSumInt"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Sales grouped by waiter/cashier for a basic employee performance view.
   *  Field names for "who served this" vary by iiko install (WaiterName /
   *  CashierName aren't guaranteed to exist), so the caller
   *  (dashboardService) resolves them dynamically via getOlapColumns("SALES")
   *  and passes the resolved field names in — same pattern as
   *  getOlapTransactions() below. */
  async getOlapByEmployee(from, to, groupByRowFields) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields,
      aggregateFields: ["DishAmountInt", "DishSumInt", "UniqOrderId"],
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Generic escape hatch for the SALES OLAP report with caller-supplied
   *  fields — used for the "risky operations" report (deletions/refunds/
   *  discounts), where the exact field set is resolved dynamically by
   *  dashboardService via getOlapColumns("SALES") since it varies by
   *  install. Rows come back untouched from parseOlap(). */
  async getOlapRiskyOps(from, to, groupByRowFields, aggregateFields) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: false,
      groupByRowFields,
      aggregateFields,
      filters: {
        "OpenDate.Typed": this.dateRangeFilter(from, to),
      },
    });
  }

  /** Fetches the list of fields available for a given OLAP report type
   *  (e.g. "TRANSACTIONS"), including their name/type/grouping/aggregation
   *  capability. Different iiko installs/versions expose different field
   *  sets for the transactions report, so callers should discover field
   *  names dynamically via this method instead of hardcoding them. */
  async getOlapColumns(reportType) {
    const key = await this.getToken();
    const res = await this.http.get(`${this.baseUrl}/resto/api/v2/reports/olap/columns`, {
      params: { key, reportType },
      timeout: 20000,
    });
    if (res.status >= 200 && res.status < 300) {
      return res.data;
    }
    throw new Error(
      `GET /resto/api/v2/reports/olap/columns failed with status ${res.status}: ${this.describeError(res.data)}`
    );
  }

  /** Generic escape hatch for the TRANSACTIONS (проводки) OLAP report —
   *  used for warehouse/write-off/cost-price analytics. Field names vary
   *  by iiko install, so the caller (dashboardService) discovers them via
   *  getOlapColumns() first and passes the resolved field names in.
   *  IMPORTANT: unlike SALES, this report does NOT necessarily support
   *  "OpenDate.Typed" as a date field (confirmed: one install rejects it
   *  with "Unknown OLAP field 'OpenDate.Typed'") — the caller must resolve
   *  and pass the actual date field name for this report via dateField. */
  async getOlapTransactions(from, to, groupByRowFields, aggregateFields, dateField, extraFilters = {}) {
    return this.olapPost({
      reportType: "TRANSACTIONS",
      buildSummary: true,
      groupByRowFields,
      aggregateFields,
      filters: {
        ...(dateField ? { [dateField]: this.dateRangeFilter(from, to) } : {}),
        ...extraFilters,
      },
    });
  }

  async ping() {
    try {
      await this.getToken();
      return true;
    } catch (e) {
      console.error("[iiko] ping failed:", e.message);
      return false;
    }
  }

  /** Validates credentials without throwing — used at login time. */
  async verify() {
    await this.getToken();
    return true;
  }
}

module.exports = IikoClient;
