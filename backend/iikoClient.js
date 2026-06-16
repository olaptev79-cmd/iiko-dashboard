const axios = require("axios");

class IikoClient {
  constructor(baseUrl, login, password) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
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
    }
    return null;
  }

  async requestTokenFrom(url, options = {}) {
    const res = await this.http.request({
      url,
      ...options,
    });

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

    const attempts = [
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "get",
          params: { login: this.login, pass: this.password },
        }),
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "get",
          params: { login: this.login, password: this.password },
        }),
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "post",
          headers: { "Content-Type": "application/json" },
          data: { login: this.login, pass: this.password },
        }),
      () =>
        this.requestTokenFrom(`${this.baseUrl}/resto/api/auth`, {
          method: "post",
          headers: { "Content-Type": "application/json" },
          data: { login: this.login, password: this.password },
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
      return res.data;
    }

    if (res.status === 401 && retry) {
      this.token = null;
      this.tokenExpiry = null;
      return this.olapPost(body, false);
    }

    throw new Error(`POST /resto/api/v2/reports/olap failed with status ${res.status}`);
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

  async getOlapSales(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["OpenDate.Typed", "Department.Id", "Department.Name"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
      filters: {
        "OpenDate.Typed": {
          filterType: "DateRange",
          periodType: "CUSTOM",
          from,
          to,
        },
      },
    });
  }

  async getOlapTopDishes(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: true,
      groupByRowFields: ["Dish.Name", "Dish.Category"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
      filters: {
        "OpenDate.Typed": {
          filterType: "DateRange",
          periodType: "CUSTOM",
          from,
          to,
        },
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
}

module.exports = IikoClient;
