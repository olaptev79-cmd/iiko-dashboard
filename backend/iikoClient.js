const axios = require("axios");
const crypto = require("crypto");

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

class IikoClient {
  constructor(baseUrl, login, password) {
    this.baseUrl = normalizeUrl(baseUrl);
    this.login = login;
    this.password = password;
    this.token = null;
    this.tokenExpiry = null;
    this.http = axios.create({
      timeout: 15000,
      validateStatus: () => true,
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
      const topKeys = res.data && typeof res.data === "object" ? Object.keys(res.data) : [];
      console.log(
        "[iiko] OLAP ok. Rows:", rows,
        "| Filters:", JSON.stringify(body.filters),
        "| ResponseKeys:", JSON.stringify(topKeys)
      );
      if (rows === 1 || (Array.isArray(res.data && res.data.data) && res.data.data.length > 0)) {
        console.log("[iiko] Sample response (first 2000 chars):", JSON.stringify(res.data).slice(0, 2000));
      }
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

  parseOlap(data) {
    if (!data || !Array.isArray(data.data)) return [];
    const cols = Array.isArray(data.columnNames) ? data.columnNames : [];
    return data.data.map((row) => {
      const obj = {};
      cols.forEach((c, i) => {
        obj[c] = row[i];
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

  async getOlapSales(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["OpenDate.Typed", "Department.Id", "Department"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
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
