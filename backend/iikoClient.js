const axios = require("axios");

class IikoClient {
  constructor(baseUrl, login, password) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.login = login;
    this.password = password;
    this.token = null;
    this.tokenExpiry = null;
  }

  async getToken() {
    const now = Date.now();
    if (this.token && this.tokenExpiry && now < this.tokenExpiry) return this.token;
    const res = await axios.get(`${this.baseUrl}/resto/api/auth`, {
      params: { login: this.login, pass: this.password },
      timeout: 10000,
    });
    this.token = res.data.trim();
    this.tokenExpiry = now + 50 * 60 * 1000;
    console.log("[iiko] Токен получен:", this.token.substring(0, 8) + "...");
    return this.token;
  }

  async apiGet(path, params = {}) {
    const key = await this.getToken();
    try {
      const res = await axios.get(`${this.baseUrl}/resto/api/${path}`, {
        params: { key, ...params },
        timeout: 15000,
      });
      return res.data;
    } catch (e) {
      if (e.response && e.response.status === 401) {
        this.token = null;
        return this.apiGet(path, params);
      }
      throw e;
    }
  }

  async olapPost(body) {
    const key = await this.getToken();
    const res = await axios.post(
      `${this.baseUrl}/resto/api/v2/reports/olap`,
      body,
      { params: { key }, headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );
    return res.data;
  }

  parseOlap(data) {
    if (!data || !data.data) return [];
    const cols = data.columnNames || [];
    return data.data.map((row) => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  }

  async getDepartments() { return this.apiGet("corporation/departments"); }
  async getTerminals()   { return this.apiGet("corporation/terminals"); }
  async getEmployees()   { return this.apiGet("employees"); }

  async getOlapSales(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: "true",
      groupByRowFields: ["OpenDate.Typed", "Department.Id", "Department.Name"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
      filters: {
        "OpenDate.Typed": { filterType: "DateRange", periodType: "CUSTOM", from, to },
      },
    });
  }

  async getOlapTopDishes(from, to) {
    return this.olapPost({
      reportType: "SALES",
      buildSummary: "true",
      groupByRowFields: ["Dish.Name", "Dish.Category"],
      aggregateFields: ["DishAmountInt", "DishSumInt"],
      filters: {
        "OpenDate.Typed": { filterType: "DateRange", periodType: "CUSTOM", from, to },
      },
    });
  }

  async ping() {
    try { await this.getToken(); return true; } catch { return false; }
  }
}

module.exports = IikoClient;
