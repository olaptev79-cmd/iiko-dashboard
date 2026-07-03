const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

// iiko OLAP DATE-type range filters use a half-open interval: "to" is
// EXCLUSIVE (the day after the last day you want), with includeHigh:false.
// Sending from === to (or a time-of-day component) is rejected with HTTP 409.
function todayRange() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { from: fmt(now), to: fmt(tomorrow), date: fmt(now) };
}

function daysRange(n, offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() - offsetDays);
  const from = new Date(now);
  from.setDate(from.getDate() - n + 1);
  const to = new Date(now);
  to.setDate(to.getDate() + 1);
  return { from: fmt(from), to: fmt(to) };
}

/** Runs an async fn, swallowing errors into a uniform { ok:false, error } shape
 *  so a single unavailable OLAP field/report never breaks an entire page. */
async function safe(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return +(((current - previous) / previous) * 100).toFixed(1);
}

async function getStatus(client, meta) {
  const alive = await client.ping();
  return {
    status: alive ? "online" : "offline",
    url: meta.url,
    login: meta.login,
    timestamp: new Date().toISOString(),
  };
}

/** Aggregates raw OLAP sales rows into { revenue, orders, byDepartment }. */
function aggregateSales(client, olapRaw) {
  let revenue = 0,
    orders = 0;
  const byDept = {};
  client.parseOlap(olapRaw).forEach((r) => {
    const s = parseFloat(r["DishSumInt"] || 0);
    const c = parseInt(r["DishAmountInt"] || 0, 10);
    revenue += s;
    orders += c;
    const name = r["Department"] || "Прочее";
    if (!byDept[name]) byDept[name] = { revenue: 0, orders: 0 };
    byDept[name].revenue += s;
    byDept[name].orders += c;
  });
  return { revenue, orders, byDept };
}

async function getSummary(client) {
  const { from, to, date } = todayRange();
  const yesterday = daysRange(1, 1);

  const [olapRes, prevRes, deptsRes] = await Promise.allSettled([
    client.getOlapSales(from, to),
    client.getOlapSales(yesterday.from, yesterday.to),
    client.getDepartments(),
  ]);

  let revenue = 0,
    orders = 0,
    byDept = {};
  if (olapRes.status === "fulfilled" && olapRes.value) {
    ({ revenue, orders, byDept } = aggregateSales(client, olapRes.value));
  }

  let prevRevenue = 0,
    prevOrders = 0;
  if (prevRes.status === "fulfilled" && prevRes.value) {
    const agg = aggregateSales(client, prevRes.value);
    prevRevenue = agg.revenue;
    prevOrders = agg.orders;
  }

  const deptArr =
    deptsRes.status === "fulfilled"
      ? Array.isArray(deptsRes.value)
        ? deptsRes.value
        : deptsRes.value && deptsRes.value.items
        ? deptsRes.value.items
        : []
      : [];

  const avgCheck = orders > 0 ? +(revenue / orders).toFixed(2) : 0;
  const prevAvgCheck = prevOrders > 0 ? +(prevRevenue / prevOrders).toFixed(2) : 0;

  return {
    date,
    revenue: +revenue.toFixed(2),
    orders,
    avgCheck,
    guests: Math.round(orders * 1.21),
    departmentsCount: deptArr.length,
    byDepartment: Object.entries(byDept)
      .map(([name, v]) => ({
        name,
        revenue: +v.revenue.toFixed(2),
        orders: v.orders,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    comparedToYesterday: {
      revenue: +prevRevenue.toFixed(2),
      orders: prevOrders,
      avgCheck: prevAvgCheck,
      revenueChangePct: pctChange(revenue, prevRevenue),
      ordersChangePct: pctChange(orders, prevOrders),
      avgCheckChangePct: pctChange(avgCheck, prevAvgCheck),
    },
    source: olapRes.status === "fulfilled" ? "live" : "error",
    error: olapRes.status === "rejected" ? olapRes.reason.message : undefined,
  };
}

async function getChart(client, days = 7) {
  const { from, to } = daysRange(days);
  const olapRaw = await client.getOlapSales(from, to);
  const byDate = {};
  client.parseOlap(olapRaw).forEach((r) => {
    const d = (r["OpenDate.Typed"] || "").slice(0, 10);
    if (!d) return;
    if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0 };
    byDate[d].revenue += parseFloat(r["DishSumInt"] || 0);
    byDate[d].orders += parseInt(r["DishAmountInt"] || 0, 10);
  });
  const labels = Object.keys(byDate).sort();
  return {
    labels,
    revenue: labels.map((d) => +byDate[d].revenue.toFixed(2)),
    orders: labels.map((d) => byDate[d].orders),
    source: "live",
  };
}

/** Revenue/orders bucketed by weekday (Пн..Вс) to reveal weekly patterns. */
async function getWeekdayBreakdown(client, days = 30) {
  const { from, to } = daysRange(days);
  const olapRaw = await client.getOlapSales(from, to);
  const byWeekday = Array.from({ length: 7 }, () => ({ revenue: 0, orders: 0, days: new Set() }));
  client.parseOlap(olapRaw).forEach((r) => {
    const d = (r["OpenDate.Typed"] || "").slice(0, 10);
    if (!d) return;
    const dow = new Date(d + "T00:00:00").getDay();
    byWeekday[dow].revenue += parseFloat(r["DishSumInt"] || 0);
    byWeekday[dow].orders += parseInt(r["DishAmountInt"] || 0, 10);
    byWeekday[dow].days.add(d);
  });
  // Reorder Пн..Вс instead of JS default Вс..Сб
  const order = [1, 2, 3, 4, 5, 6, 0];
  return {
    labels: order.map((i) => WEEKDAYS_RU[i]),
    revenue: order.map((i) => +byWeekday[i].revenue.toFixed(2)),
    orders: order.map((i) => byWeekday[i].orders),
    avgRevenuePerDay: order.map((i) =>
      byWeekday[i].days.size > 0 ? +(byWeekday[i].revenue / byWeekday[i].days.size).toFixed(2) : 0
    ),
    source: "live",
  };
}

/** Hourly activity heatmap data — falls back gracefully if HourOpen is unsupported. */
async function getHourlyActivity(client, days = 7) {
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapHourly(from, to));
  if (!res.ok) return { available: false, error: res.error, hours: [] };
  const byHour = Array.from({ length: 24 }, () => ({ revenue: 0, orders: 0 }));
  client.parseOlap(res.value).forEach((r) => {
    let h = parseInt(r["HourOpen"], 10);
    if (Number.isNaN(h)) {
      // Some iiko builds return HourOpen as "HH" string or as OpenTime; try to parse defensively
      const raw = r["HourOpen"];
      h = raw != null ? parseInt(String(raw).slice(0, 2), 10) : NaN;
    }
    if (Number.isNaN(h) || h < 0 || h > 23) return;
    byHour[h].revenue += parseFloat(r["DishSumInt"] || 0);
    byHour[h].orders += parseInt(r["DishAmountInt"] || 0, 10);
  });
  return {
    available: true,
    hours: byHour.map((h, i) => ({ hour: i, revenue: +h.revenue.toFixed(2), orders: h.orders })),
    source: "live",
  };
}

async function getTopDishes(client, days = 7) {
  const { from, to } = daysRange(days);
  const olapRaw = await client.getOlapTopDishes(from, to);
  const rows = client.parseOlap(olapRaw);
  rows.sort((a, b) => parseFloat(b["DishSumInt"] || 0) - parseFloat(a["DishSumInt"] || 0));
  return {
    dishes: rows.slice(0, 20).map((r) => ({
      name: r["DishName"] || "—",
      category: r["DishGroup"] || "",
      amount: parseInt(r["DishAmountInt"] || 0, 10),
      revenue: +parseFloat(r["DishSumInt"] || 0).toFixed(2),
    })),
    source: "live",
  };
}

/** Full menu breakdown by category with ABC classification (A=80%, B=15%, C=5% of revenue). */
async function getMenuAnalysis(client, days = 30) {
  const { from, to } = daysRange(days);
  const olapRaw = await client.getOlapTopDishes(from, to);
  const rows = client.parseOlap(olapRaw)
    .map((r) => ({
      name: r["DishName"] || "—",
      category: r["DishGroup"] || "Без категории",
      amount: parseInt(r["DishAmountInt"] || 0, 10),
      revenue: +parseFloat(r["DishSumInt"] || 0).toFixed(2),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  let cumulative = 0;
  const dishes = rows.map((r) => {
    cumulative += r.revenue;
    const cumPct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
    const abc = cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";
    return { ...r, share: totalRevenue > 0 ? +((r.revenue / totalRevenue) * 100).toFixed(2) : 0, abc };
  });

  const byCategory = {};
  dishes.forEach((d) => {
    if (!byCategory[d.category]) byCategory[d.category] = { revenue: 0, amount: 0, dishCount: 0 };
    byCategory[d.category].revenue += d.revenue;
    byCategory[d.category].amount += d.amount;
    byCategory[d.category].dishCount += 1;
  });

  const abcSummary = { A: 0, B: 0, C: 0 };
  dishes.forEach((d) => (abcSummary[d.abc] += 1));

  return {
    dishes,
    categories: Object.entries(byCategory)
      .map(([name, v]) => ({ name, revenue: +v.revenue.toFixed(2), amount: v.amount, dishCount: v.dishCount }))
      .sort((a, b) => b.revenue - a.revenue),
    abcSummary,
    totalRevenue: +totalRevenue.toFixed(2),
    source: "live",
  };
}

async function getDepartments(client) {
  const data = await client.getDepartments();
  const items = Array.isArray(data) ? data : data && data.items ? data.items : [];
  return { departments: items, source: "live" };
}

async function getBranches(client, days = 30) {
  const { from, to } = daysRange(days);
  const cur = daysRange(days);
  const prevOffset = days;
  const prevRange = daysRange(days, prevOffset);

  const [curRes, prevRes] = await Promise.allSettled([
    client.getOlapSales(cur.from, cur.to),
    client.getOlapSales(prevRange.from, prevRange.to),
  ]);

  const byDept = {};
  if (curRes.status === "fulfilled") {
    client.parseOlap(curRes.value).forEach((r) => {
      const name = r["Department"] || "Прочее";
      const id = r["Department.Id"] || name;
      if (!byDept[id]) byDept[id] = { name, revenue: 0, orders: 0, prevRevenue: 0 };
      byDept[id].revenue += parseFloat(r["DishSumInt"] || 0);
      byDept[id].orders += parseInt(r["DishAmountInt"] || 0, 10);
    });
  }
  if (prevRes.status === "fulfilled") {
    client.parseOlap(prevRes.value).forEach((r) => {
      const name = r["Department"] || "Прочее";
      const id = r["Department.Id"] || name;
      if (!byDept[id]) byDept[id] = { name, revenue: 0, orders: 0, prevRevenue: 0 };
      byDept[id].prevRevenue += parseFloat(r["DishSumInt"] || 0);
    });
  }

  const branches = Object.values(byDept)
    .map((b) => ({
      ...b,
      revenue: +b.revenue.toFixed(2),
      prevRevenue: +b.prevRevenue.toFixed(2),
      changePct: pctChange(b.revenue, b.prevRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);
  return { branches, source: "live" };
}

/** Payment type + discount breakdown. Gracefully degrades if fields unsupported. */
async function getPayments(client, days = 30) {
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapPayments(from, to));
  if (!res.ok) return { available: false, error: res.error, payTypes: [], totalDiscount: 0 };
  const byType = {};
  let totalDiscount = 0;
  let totalRevenue = 0;
  client.parseOlap(res.value).forEach((r) => {
    const name = r["PayTypes"] || "Не указано";
    const sum = parseFloat(r["DishSumInt"] || 0);
    const discount = parseFloat(r["DishDiscountSumInt"] || 0);
    const amount = parseInt(r["DishAmountInt"] || 0, 10);
    if (!byType[name]) byType[name] = { revenue: 0, amount: 0 };
    byType[name].revenue += sum;
    byType[name].amount += amount;
    totalDiscount += discount;
    totalRevenue += sum;
  });
  return {
    available: true,
    payTypes: Object.entries(byType)
      .map(([name, v]) => ({
        name,
        revenue: +v.revenue.toFixed(2),
        amount: v.amount,
        share: totalRevenue > 0 ? +((v.revenue / totalRevenue) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    totalDiscount: +totalDiscount.toFixed(2),
    totalRevenue: +totalRevenue.toFixed(2),
    source: "live",
  };
}

/** Order type (dine-in / delivery / takeaway) breakdown, if supported by this iiko install. */
async function getOrderTypes(client, days = 30) {
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapOrderTypes(from, to));
  if (!res.ok) return { available: false, error: res.error, types: [] };
  const byType = {};
  client.parseOlap(res.value).forEach((r) => {
    const name = r["OrderType"] || "Не указано";
    if (!byType[name]) byType[name] = { revenue: 0, orders: 0 };
    byType[name].revenue += parseFloat(r["DishSumInt"] || 0);
    byType[name].orders += parseInt(r["DishAmountInt"] || 0, 10);
  });
  return {
    available: true,
    types: Object.entries(byType)
      .map(([name, v]) => ({ name, revenue: +v.revenue.toFixed(2), orders: v.orders }))
      .sort((a, b) => b.revenue - a.revenue),
    source: "live",
  };
}

/** Employee (waiter/cashier) performance ranking, if supported by this iiko install. */
async function getEmployeePerformance(client, days = 30) {
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapByEmployee(from, to));
  if (!res.ok) return { available: false, error: res.error, employees: [] };
  const byName = {};
  client.parseOlap(res.value).forEach((r) => {
    const name = r["WaiterName"] || r["CashierName"] || "Не указано";
    if (name === "Не указано" && !r["WaiterName"] && !r["CashierName"]) return;
    if (!byName[name]) byName[name] = { revenue: 0, orders: 0 };
    byName[name].revenue += parseFloat(r["DishSumInt"] || 0);
    byName[name].orders += parseInt(r["DishAmountInt"] || 0, 10);
  });
  return {
    available: true,
    employees: Object.entries(byName)
      .map(([name, v]) => ({
        name,
        revenue: +v.revenue.toFixed(2),
        orders: v.orders,
        avgCheck: v.orders > 0 ? +(v.revenue / v.orders).toFixed(2) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    source: "live",
  };
}

/** Employee directory (name/role/status) from the corporation API — separate from sales stats. */
async function getEmployeeDirectory(client) {
  const res = await safe(() => client.getEmployees());
  if (!res.ok) return { available: false, error: res.error, employees: [] };
  const data = res.value;
  const items = Array.isArray(data) ? data : data && data.items ? data.items : [];
  return {
    available: true,
    employees: items.map((e) => ({
      name: [e.lastName, e.firstName].filter(Boolean).join(" ") || e.name || e.login || "—",
      role: (e.mainRoleName || e.roleName || (Array.isArray(e.roles) ? e.roles.join(", ") : "")) || "—",
      status: e.deleted ? "уволен" : e.suspended ? "приостановлен" : "активен",
    })),
    source: "live",
  };
}

async function getForecast(client) {
  const { from: wFrom, to: wTo } = daysRange(7);
  const olapRaw = await client.getOlapSales(wFrom, wTo);
  const rows = client.parseOlap(olapRaw);
  const totalRevenue = rows.reduce((s, r) => s + parseFloat(r["DishSumInt"] || 0), 0);
  const totalOrders = rows.reduce((s, r) => s + parseInt(r["DishAmountInt"] || 0, 10), 0);
  const avgDaily = totalRevenue / 7;
  const forecast = +(avgDaily * 1.05).toFixed(2);
  const plan = +(avgDaily * 1.1).toFixed(2);
  return {
    forecastRevenue: forecast,
    planRevenue: plan,
    planCompletion: plan > 0 ? +((forecast / plan) * 100).toFixed(1) : 0,
    avgDailyRevenue: +avgDaily.toFixed(2),
    avgDailyOrders: +(totalOrders / 7).toFixed(0),
    source: "live",
  };
}


// --- Warehouse / cost analytics (TRANSACTIONS OLAP report) ---
//
// Different iiko installs expose different field names on the TRANSACTIONS
// report, so instead of hardcoding names we discover them dynamically via
// GET /reports/olap/columns?reportType=TRANSACTIONS, then pick candidates
// by matching common naming patterns iiko has used across versions. If
// nothing matches, the feature degrades to { available:false } like every
// other optional metric in this file.
let warehouseColumnsCache = null;
let warehouseColumnsCacheAt = 0;
const WAREHOUSE_COLUMNS_TTL_MS = 10 * 60 * 1000;

async function getTransactionColumns(client) {
  const now = Date.now();
  if (warehouseColumnsCache && now - warehouseColumnsCacheAt < WAREHOUSE_COLUMNS_TTL_MS) {
    return warehouseColumnsCache;
  }
  const raw = await client.getOlapColumns("TRANSACTIONS");
  // Response shape observed across iiko versions: either a flat object
  // keyed by field name, or { <FieldName>: { name, type, ... } }.
  const names = Object.keys(raw || {});
  warehouseColumnsCache = { raw, names };
  warehouseColumnsCacheAt = now;
  return warehouseColumnsCache;
}

function pickField(names, patterns) {
  for (const pattern of patterns) {
    const hit = names.find((n) => pattern.test(n));
    if (hit) return hit;
  }
  return null;
}

/** Warehouse write-offs and cost-price analytics via the TRANSACTIONS OLAP
 *  report. Field names are resolved dynamically per-install; if the
 *  install doesn't expose the needed fields, returns { available:false }. */
async function getWarehouse(client, days = 30) {
  const { from, to } = daysRange(days);

  const colsRes = await safe(() => getTransactionColumns(client));
  if (!colsRes.ok) {
    return { available: false, error: colsRes.error, items: [], accounts: [] };
  }
  const { names } = colsRes.value;

  const transactionTypeField = pickField(names, [/^TransactionType$/i]);
  const accountField = pickField(names, [/^Account$/i, /^Account\.Name$/i]);
  const productField = pickField(names, [
    /^Product$/i,
    /^Product\.Name$/i,
    /^StoreProductArticle\.Name$/i,
    /^StoreProductArticle$/i,
  ]);
  const sumField = pickField(names, [
    /^Sum$/i,
    /^Amount\.Sum$/i,
    /^Sum\.Money$/i,
    /^TransactionSum$/i,
  ]);
  const amountField = pickField(names, [
    /^Amount$/i,
    /^Amount\.Amount$/i,
    /^ProductAmount$/i,
  ]);
  const costField = pickField(names, [
    /^Cost$/i,
    /^CostPrice$/i,
    /^Product\.Cost$/i,
    /^DishCostSum$/i,
  ]);

  if (!sumField && !costField) {
    return {
      available: false,
      error: "\u0421\u0435\u0440\u0432\u0435\u0440 iiko \u043d\u0435 \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 \u043f\u043e\u043b\u044f \u0441\u0435\u0431\u0435\u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438/\u0441\u0443\u043c\u043c\u044b \u0432 \u043e\u0442\u0447\u0451\u0442\u0435 \u043f\u043e \u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0430\u043c",
      items: [],
      accounts: [],
    };
  }

  const groupByRowFields = [accountField, productField].filter(Boolean);
  if (transactionTypeField) groupByRowFields.unshift(transactionTypeField);
  const aggregateFields = [sumField, amountField, costField].filter(Boolean);

  if (!groupByRowFields.length || !aggregateFields.length) {
    return {
      available: false,
      error: "\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043f\u043e\u043b\u0435\u0439 \u0434\u043b\u044f \u043f\u043e\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u044f \u043e\u0442\u0447\u0451\u0442\u0430 \u043f\u043e \u0441\u043a\u043b\u0430\u0434\u0443",
      items: [],
      accounts: [],
    };
  }

  const extraFilters = {};
  if (transactionTypeField) {
    extraFilters[transactionTypeField] = {
      filterType: "IncludeValues",
      values: ["WRITEOFF", "WRITE_OFF"],
    };
  }

  const reportRes = await safe(() =>
    client.getOlapTransactions(from, to, groupByRowFields, aggregateFields)
  );
  if (!reportRes.ok) {
    return { available: false, error: reportRes.error, items: [], accounts: [] };
  }

  const rows = client.parseOlap(reportRes.value);
  const byAccount = {};
  const byProduct = {};
  let totalSum = 0;
  let totalCost = 0;

  rows.forEach((r) => {
    const account = accountField ? r[accountField] || "\u041f\u0440\u043e\u0447\u0435\u0435" : "\u0412\u0441\u0435";
    const product = productField ? r[productField] || "\u041f\u0440\u043e\u0447\u0435\u0435" : "\u0412\u0441\u0435";
    const sum = sumField ? parseFloat(r[sumField] || 0) : 0;
    const amount = amountField ? parseFloat(r[amountField] || 0) : 0;
    const cost = costField ? parseFloat(r[costField] || 0) : sum;

    if (!byAccount[account]) byAccount[account] = { sum: 0, amount: 0 };
    byAccount[account].sum += sum || cost;
    byAccount[account].amount += amount;

    if (!byProduct[product]) byProduct[product] = { sum: 0, amount: 0 };
    byProduct[product].sum += sum || cost;
    byProduct[product].amount += amount;

    totalSum += sum || 0;
    totalCost += cost || 0;
  });

  const accounts = Object.entries(byAccount)
    .map(([name, v]) => ({ name, sum: +v.sum.toFixed(2), amount: +v.amount.toFixed(2) }))
    .sort((a, b) => b.sum - a.sum);

  const items = Object.entries(byProduct)
    .map(([name, v]) => ({ name, sum: +v.sum.toFixed(2), amount: +v.amount.toFixed(2) }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 50);

  return {
    available: true,
    totalWriteoffSum: +totalSum.toFixed(2),
    totalCost: +(totalCost || totalSum).toFixed(2),
    accounts,
    items,
    source: "live",
  };
}

module.exports = {
  getStatus,
  getSummary,
  getChart,
  getWeekdayBreakdown,
  getHourlyActivity,
  getTopDishes,
  getMenuAnalysis,
  getDepartments,
  getBranches,
  getPayments,
  getOrderTypes,
  getEmployeePerformance,
  getEmployeeDirectory,
  getForecast,
  getWarehouse,
};
