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

// --- Calendar-aligned date ranges (distinct from the rolling daysRange()
// above) — used by guest-count/average-check "this week"/"this month"
// widgets, where offset=1 must give a PARTIAL-to-PARTIAL comparison (e.g.
// "first 3 days of this week" vs "first 3 days of last week"), not a
// misleading partial-vs-full-period comparison.
function startOfWeek(d) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday-start week
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return m;
}

function weekToDateRange(offsetWeeks = 0) {
  const now = new Date();
  now.setDate(now.getDate() - offsetWeeks * 7);
  const monday = startOfWeek(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { from: fmt(monday), to: fmt(tomorrow) };
}

function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function monthToDateRange(offsetMonths = 0) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - offsetMonths, 1);
  const cursorDay = offsetMonths === 0 ? now.getDate() : Math.min(now.getDate(), daysInMonth(target));
  const to = new Date(target.getFullYear(), target.getMonth(), cursorDay + 1);
  return { from: fmt(target), to: fmt(to) };
}

/** Exclusive "to" (day after the given date) — for turning a single
 *  inclusive end-date into the half-open interval iiko's OLAP expects. */
function exclusiveTo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return fmt(d);
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

/** Aggregates raw OLAP sales rows into { revenue, orders, guests, byDepartment }.
 *  `guestField`, if resolved by the caller via getSalesColumns()+pickField(),
 *  is summed as real guest count; omit it to skip guest aggregation entirely. */
function aggregateSales(client, olapRaw, guestField) {
  let revenue = 0,
    orders = 0,
    guests = 0;
  const byDept = {};
  client.parseOlap(olapRaw).forEach((r) => {
    const s = parseFloat(r["DishSumInt"] || 0);
    const c = parseInt(r["DishAmountInt"] || 0, 10);
    revenue += s;
    orders += c;
    if (guestField) guests += parseFloat(r[guestField] || 0);
    const name = r["Department"] || "Прочее";
    if (!byDept[name]) byDept[name] = { revenue: 0, orders: 0 };
    byDept[name].revenue += s;
    byDept[name].orders += c;
  });
  return { revenue, orders, guests, byDept };
}

// Field-name patterns for the OLAP SALES guest-count field. Varies by
// install like every other OLAP field name in this file — resolved
// dynamically via getSalesColumns()+pickField(), never hardcoded.
const GUEST_FIELD_PATTERNS = [/^GuestNum$/i, /^Guests?\.Num$/i, /^GuestCount$/i, /^DishGuestNum$/i, /^OrderGuestNum$/i];

async function getSummary(client) {
  const { from, to, date } = todayRange();
  const yesterday = daysRange(1, 1);

  const colsRes = await safe(() => getSalesColumns(client));
  const guestField = colsRes.ok ? pickField(colsRes.value.names, GUEST_FIELD_PATTERNS) : null;

  const [olapRes, prevRes, deptsRes] = await Promise.allSettled([
    client.getOlapSales(from, to, guestField ? [guestField] : []),
    client.getOlapSales(yesterday.from, yesterday.to, guestField ? [guestField] : []),
    client.getDepartments(),
  ]);

  let revenue = 0,
    orders = 0,
    guests = 0,
    byDept = {};
  if (olapRes.status === "fulfilled" && olapRes.value) {
    ({ revenue, orders, guests, byDept } = aggregateSales(client, olapRes.value, guestField));
  }

  let prevRevenue = 0,
    prevOrders = 0;
  if (prevRes.status === "fulfilled" && prevRes.value) {
    const agg = aggregateSales(client, prevRes.value, guestField);
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
    guests: guestField ? Math.round(guests) : Math.round(orders * 1.21),
    guestsSource: guestField ? "live" : "estimated",
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

// Field-name patterns for "who served this" (waiter/cashier). Field names
// vary a lot across iiko versions/installs — WaiterName/CashierName are NOT
// guaranteed to exist as literal field names (confirmed: one install rejects
// "CashierName" outright with HTTP 400 "Unknown OLAP field"). Shared by
// getEmployeePerformance() and getRiskyOperations(), both of which resolve
// the actual field dynamically via getSalesColumns() + pickField().
const WAITER_FIELD_PATTERNS = [/^WaiterName$/i, /^Waiter\.Name$/i, /^Waiter$/i, /^OrderWaiter\.Name$/i];
const CASHIER_FIELD_PATTERNS = [/^CashierName$/i, /^Cashier\.Name$/i, /^Cashier$/i, /^OrderCashier\.Name$/i];

/** Employee (waiter/cashier) performance ranking, if supported by this iiko
 *  install. Field names for "who served this" vary a lot across iiko
 *  versions (WaiterName/CashierName aren't guaranteed to exist as literal
 *  field names), so they're resolved dynamically via getSalesColumns() +
 *  pickField() instead of being hardcoded. */
async function getEmployeePerformance(client, days = 30) {
  const { from, to } = daysRange(days);

  const colsRes = await safe(() => getSalesColumns(client));
  if (!colsRes.ok) return { available: false, error: colsRes.error, employees: [] };
  const { names } = colsRes.value;

  const waiterField = pickField(names, WAITER_FIELD_PATTERNS);
  const cashierField = pickField(names, CASHIER_FIELD_PATTERNS);

  const employeeFields = [waiterField, cashierField].filter(Boolean);
  if (!employeeFields.length) {
    return {
      available: false,
      error:
        "\u0421\u0435\u0440\u0432\u0435\u0440 iiko \u043d\u0435 \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 \u043f\u043e\u043b\u0435 \u043e\u0444\u0438\u0446\u0438\u0430\u043d\u0442\u0430/\u043a\u0430\u0441\u0441\u0438\u0440\u0430 \u0432 \u043e\u0442\u0447\u0451\u0442\u0435 \u043f\u043e \u043f\u0440\u043e\u0434\u0430\u0436\u0430\u043c",
      employees: [],
    };
  }

  const res = await safe(() => client.getOlapByEmployee(from, to, employeeFields));
  if (!res.ok) return { available: false, error: res.error, employees: [] };
  const byName = {};
  client.parseOlap(res.value).forEach((r) => {
    const name = (waiterField && r[waiterField]) || (cashierField && r[cashierField]) || "Не указано";
    if (name === "Не указано" && !(waiterField && r[waiterField]) && !(cashierField && r[cashierField])) return;
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
      id: e.id,
      login: e.login || null,
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

let salesColumnsCache = null;
let salesColumnsCacheAt = 0;
const SALES_COLUMNS_TTL_MS = 10 * 60 * 1000;

/** Same dynamic-discovery approach as getTransactionColumns(), but for the
 *  SALES report — used by getRiskyOperations() below to find fields for
 *  deletions/refunds/discounts, which vary by iiko install/version. */
async function getSalesColumns(client) {
  const now = Date.now();
  if (salesColumnsCache && now - salesColumnsCacheAt < SALES_COLUMNS_TTL_MS) {
    return salesColumnsCache;
  }
  const raw = await client.getOlapColumns("SALES");
  const names = Object.keys(raw || {});
  salesColumnsCache = { raw, names };
  salesColumnsCacheAt = now;
  return salesColumnsCache;
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

  // Unlike SALES, TRANSACTIONS may not expose "OpenDate.Typed" at all
  // (confirmed: rejected with "Unknown OLAP field 'OpenDate.Typed'" on one
  // install) — resolve the date field dynamically per-install instead of
  // hardcoding it, mirroring every other field in this function.
  const dateField = pickField(names, [
    /^OpenDate\.Typed$/i,
    /^Date\.Typed$/i,
    /^Date$/i,
    /^TransactionDate$/i,
    /^Transaction\.Date$/i,
    /^DateTime\.Typed$/i,
    /^DocumentDate$/i,
    /^CloseDate\.Typed$/i,
    /Date\.Typed$/i,
    /Date$/i,
  ]);

  const transactionTypeField = pickField(names, [
    /^TransactionType$/i,
    /^Transaction\.Type$/i,
    /^Type$/i,
    /^DocumentType$/i,
  ]);
  const accountField = pickField(names, [
    /^Account$/i,
    /^Account\.Name$/i,
    /^Store$/i,
    /^Store\.Name$/i,
    /^Department\.Name$/i,
    /^Account\.Id$/i,
  ]);
  const productField = pickField(names, [
    /^Product$/i,
    /^Product\.Name$/i,
    /^StoreProductArticle\.Name$/i,
    /^StoreProductArticle$/i,
    /^ProductName$/i,
    /^DishName$/i,
    /^Good\.Name$/i,
    /^Good$/i,
    /^Item\.Name$/i,
    /^Nomenclature\.Name$/i,
  ]);
  // Broadened (best-effort) beyond the original anchored-exact patterns: iiko
  // installs have been observed to use many variants for the write-off
  // money amount. Kept in priority order (most-specific/likely first), with
  // looser, unanchored fallbacks (e.g. /Sum$/i, /CostSum/i) added last so an
  // exact/more-specific match is always preferred when both exist.
  const sumField = pickField(names, [
    /^Sum$/i,
    /^Amount\.Sum$/i,
    /^Sum\.Money$/i,
    /^TransactionSum$/i,
    /^WriteoffSum$/i,
    /^Writeoff\.Sum$/i,
    /^SumWithoutVAT$/i,
    /^Sum\.Sum$/i,
    /^Amount\.Money$/i,
    /WriteoffSum/i,
    /TransactionSum/i,
    /Sum$/i,
  ]);
  const amountField = pickField(names, [
    /^Amount$/i,
    /^Amount\.Amount$/i,
    /^ProductAmount$/i,
    /^Amount\.Number$/i,
    /^Num$/i,
    /^Quantity$/i,
    /Amount$/i,
  ]);
  const costField = pickField(names, [
    /^Cost$/i,
    /^CostPrice$/i,
    /^Product\.Cost$/i,
    /^DishCostSum$/i,
    /^Cost\.Cost$/i,
    /^CostSum$/i,
    /^Cost\.Sum$/i,
    /^SumCost$/i,
    /CostSum/i,
    /Cost$/i,
  ]);

  if (!sumField && !costField) {
    return {
      available: false,
      error: "\u0421\u0435\u0440\u0432\u0435\u0440 iiko \u043d\u0435 \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 \u043f\u043e\u043b\u044f \u0441\u0435\u0431\u0435\u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438/\u0441\u0443\u043c\u043c\u044b \u0432 \u043e\u0442\u0447\u0451\u0442\u0435 \u043f\u043e \u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0430\u043c",
      items: [],
      accounts: [],
    };
  }

  if (!dateField) {
    return {
      available: false,
      error: "\u0421\u0435\u0440\u0432\u0435\u0440 iiko \u043d\u0435 \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 \u043f\u043e\u043b\u0435 \u0434\u0430\u0442\u044b \u0432 \u043e\u0442\u0447\u0451\u0442\u0435 \u043f\u043e \u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0430\u043c",
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

  // NOTE: filtering server-side by TransactionType value (e.g.
  // "WRITEOFF"/"WRITE_OFF") is NOT safe — TransactionType is a Java enum
  // on the iiko backend (resto.back.accounting.TransactionType) whose exact
  // constant names vary by install/version (confirmed: this install rejects
  // "WRITE_OFF" with "No enum constant ... TransactionType.WRITE_OFF"), and
  // we have no reliable way to discover the valid enum values ahead of time.
  // So instead of sending an IncludeValues filter, ALL transactions are
  // fetched for the period and the write-off subset is matched client-side
  // (case-insensitive substring match against common write-off wording),
  // which degrades gracefully to "show all" if the value doesn't look like
  // a recognizable write-off label.
  const reportRes = await safe(() =>
    client.getOlapTransactions(from, to, groupByRowFields, aggregateFields, dateField, {})
  );
  if (!reportRes.ok) {
    return { available: false, error: reportRes.error, items: [], accounts: [] };
  }

  const WRITEOFF_LABEL_PATTERN = /writeoff|write.off|\u0441\u043f\u0438\u0441\u0430\u043d/i;
  let allRows = client.parseOlap(reportRes.value);
  const rows = transactionTypeField
    ? allRows.filter((r) => WRITEOFF_LABEL_PATTERN.test(String(r[transactionTypeField] || "")))
    : allRows;
  // If filtering by the recognizable write-off wording eliminated everything
  // (e.g. this install labels write-offs completely differently), fall back
  // to showing all transactions for the period rather than an empty report —
  // still more useful than nothing, and the account/product breakdown below
  // still reflects real activity even if it isn't purely write-offs.
  const effectiveRows = transactionTypeField && rows.length === 0 && allRows.length > 0 ? allRows : rows;
  const byAccount = {};
  const byProduct = {};
  let totalSum = 0;
  let totalCost = 0;

  effectiveRows.forEach((r) => {
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
    // true = confidently showing only write-off transactions; false = this
    // install's TransactionType values didn't match recognizable write-off
    // wording, so ALL transactions for the period are shown instead (still
    // useful, but the numbers include non-write-off activity too).
    filteredToWriteoffs: effectiveRows === rows && !!transactionTypeField && rows.length > 0,
    source: "live",
  };
}

// --- Risky ("dangerous") register operations — discounts, deletions,
// refunds, voided/cancelled checks — surfaced via the SALES OLAP report.
//
// Exact field names for deletion/refund/discount/waiter/cashier markers vary
// across iiko versions/installs, so ALL of them (mirroring getWarehouse()
// above) are resolved dynamically via getSalesColumns() + pickField() rather
// than hardcoded. Earlier revisions of this feature assumed WaiterName/
// CashierName were confirmed-working literal field names — that assumption
// was wrong (this install rejects "CashierName" with HTTP 400 "Unknown OLAP
// field"), so those two are now resolved the same way as everything else.
// Only fields that are structurally guaranteed by the SALES report itself
// (date/hour/order id/dish name/sum, used elsewhere in this file without
// issue) remain as literals.
const DISCOUNT_PERCENT_THRESHOLD = 15; // manual discounts at/above this % are flagged "risky"

async function getRiskyOperations(client, days = 30) {
  const { from, to } = daysRange(days);

  const colsRes = await safe(() => getSalesColumns(client));
  if (!colsRes.ok) {
    return { available: false, error: colsRes.error, events: [], byEmployee: [], totals: {} };
  }
  const { names } = colsRes.value;

  // Fields used directly — structurally standard SALES report fields,
  // already relied upon elsewhere in this file (getSummary/getChart/etc.)
  // without issue on this install.
  const DELETED_WITH_WRITEOFF = "DeletedWithWriteoff";
  const DISCOUNT_SUM = "DishDiscountSumInt";
  const ORDER_TYPE = "OrderType";
  const DATE_FIELD = "OpenDate.Typed";
  const HOUR_FIELD = "HourOpen";
  const DISH_NAME = "DishName";
  const DISH_SUM = "DishSumInt";

  // Dynamically-discovered fields — not confirmed on every install, so we
  // fall back gracefully (a field that isn't found is simply omitted from
  // groupByRowFields and its signal is skipped when classifying events).
  const waiterField = pickField(names, WAITER_FIELD_PATTERNS);
  const cashierField = pickField(names, CASHIER_FIELD_PATTERNS);
  const orderDeletedField = pickField(names, [/^OrderDeleted$/i, /^Order\.Deleted$/i]);
  const checkRefundField = pickField(names, [/^StornoReason$/i, /^Storno$/i, /^IsReturn$/i, /^ReturnedSum$/i]);
  const discountNameField = pickField(names, [/^DiscountName$/i, /^Discounts\.Name$/i, /^Discount$/i]);
  const discountPercentField = pickField(names, [/^DiscountPercent$/i, /^Discounts\.Percent$/i]);
  const deletionCommentField = pickField(names, [/DeletionComment/i, /DeleteComment/i, /RemovalComment/i]);
  const payTypesField = pickField(names, [/^PayTypes$/i]);

  // NOTE: UniqOrderId is NOT allowed in groupByRowFields on this install
  // ("Grouping is not allowed for field 'UniqOrderId'") — iiko treats it as
  // an aggregate-only/summary field, not a groupable dimension there either
  // (aggregating it would return a meaningless SUM of order ids, not an
  // actual order id to display/link). So it's dropped entirely rather than
  // moved to aggregateFields — events fall back to dish name / employee /
  // date instead of a per-event order id (see events.push() below).
  const groupByRowFields = [
    DATE_FIELD,
    HOUR_FIELD,
    waiterField,
    cashierField,
    DISH_NAME,
    DELETED_WITH_WRITEOFF,
    ORDER_TYPE,
    orderDeletedField,
    checkRefundField,
    discountNameField,
    discountPercentField,
    deletionCommentField,
    payTypesField,
  ].filter(Boolean);

  const aggregateFields = [DISH_SUM, DISCOUNT_SUM].filter(Boolean);

  const reportRes = await safe(() =>
    client.getOlapRiskyOps(from, to, groupByRowFields, aggregateFields)
  );
  if (!reportRes.ok) {
    return { available: false, error: reportRes.error, events: [], byEmployee: [], totals: {} };
  }

  const rows = client.parseOlap(reportRes.value);
  const events = [];

  rows.forEach((r) => {
    const sum = parseFloat(r[DISH_SUM] || 0);
    const discountSum = parseFloat(r[DISCOUNT_SUM] || 0);
    const deletedWithWriteoff = String(r[DELETED_WITH_WRITEOFF] || "").toUpperCase();
    const isDeletedDish =
      deletedWithWriteoff && deletedWithWriteoff !== "NOT_DELETED" && deletedWithWriteoff !== "FALSE" && deletedWithWriteoff !== "0";
    const isOrderDeleted = orderDeletedField
      ? ["TRUE", "1", "YES"].includes(String(r[orderDeletedField] || "").toUpperCase())
      : false;
    const isRefund = checkRefundField
      ? ["TRUE", "1", "YES"].includes(String(r[checkRefundField] || "").toUpperCase()) || parseFloat(r[checkRefundField] || 0) > 0
      : false;
    const discountPercent = discountPercentField ? parseFloat(r[discountPercentField] || 0) : null;
    // If the install doesn't expose an explicit discount-percent field,
    // approximate it from discount sum vs. dish sum (before discount) so a
    // few-ruble discount isn't flagged as "risky" just because the percent
    // field itself is unavailable.
    const impliedPercent =
      discountPercent != null ? discountPercent : sum + discountSum > 0 ? (discountSum / (sum + discountSum)) * 100 : 0;
    const isBigDiscount = discountSum > 0 && impliedPercent >= DISCOUNT_PERCENT_THRESHOLD;
    const isDeliveryPaymentRemoved =
      payTypesField && !r[payTypesField] && String(r[ORDER_TYPE] || "").toLowerCase().includes("delivery");

    const reasons = [];
    if (isDeletedDish) reasons.push({ type: "deleted_dish", label: "Удаление блюда со списанием" });
    if (isOrderDeleted) reasons.push({ type: "order_deleted", label: "Полное аннулирование чека" });
    if (isRefund) reasons.push({ type: "refund", label: "Возврат денег после оплаты" });
    if (isBigDiscount) reasons.push({ type: "big_discount", label: "Крупная/ручная скидка" });
    if (isDeliveryPaymentRemoved) reasons.push({ type: "payment_removed", label: "Удалена привязанная оплата (доставка)" });

    if (!reasons.length) return;

    const employee = (waiterField && r[waiterField]) || (cashierField && r[cashierField]) || "Не указано";
    const date = r[DATE_FIELD] || null;
    const hour = r[HOUR_FIELD] != null ? r[HOUR_FIELD] : null;

    reasons.forEach((reason) => {
      events.push({
        type: reason.type,
        label: reason.label,
        date,
        hour,
        employee,
        dish: r[DISH_NAME] || null,
        discountName: discountNameField ? r[discountNameField] || null : null,
        discountPercent,
        sum: +sum.toFixed(2),
        discountSum: +discountSum.toFixed(2),
        comment: deletionCommentField ? r[deletionCommentField] || null : null,
      });
    });
  });

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return (b.hour || 0) - (a.hour || 0);
  });

  const byEmployee = {};
  events.forEach((e) => {
    if (!byEmployee[e.employee]) {
      byEmployee[e.employee] = { name: e.employee, total: 0, sum: 0, byType: {} };
    }
    byEmployee[e.employee].total += 1;
    byEmployee[e.employee].sum += e.discountSum || e.sum || 0;
    byEmployee[e.employee].byType[e.type] = (byEmployee[e.employee].byType[e.type] || 0) + 1;
  });

  const totals = {
    events: events.length,
    deletedDish: events.filter((e) => e.type === "deleted_dish").length,
    orderDeleted: events.filter((e) => e.type === "order_deleted").length,
    refund: events.filter((e) => e.type === "refund").length,
    bigDiscount: events.filter((e) => e.type === "big_discount").length,
    paymentRemoved: events.filter((e) => e.type === "payment_removed").length,
    discountSum: +events.reduce((s, e) => s + (e.discountSum || 0), 0).toFixed(2),
  };

  return {
    available: true,
    events: events.slice(0, 300),
    byEmployee: Object.values(byEmployee)
      .map((e) => ({ ...e, sum: +e.sum.toFixed(2) }))
      .sort((a, b) => b.total - a.total),
    totals,
    fieldsDetected: {
      waiter: !!waiterField,
      cashier: !!cashierField,
      orderDeleted: !!orderDeletedField,
      refund: !!checkRefundField,
      discountName: !!discountNameField,
      discountPercent: !!discountPercentField,
      deletionComment: !!deletionCommentField,
    },
    source: "live",
  };
}

// --- Employee credentials editor (login/password/PIN) ---
//
// Field names for password/PIN are NOT confirmed against a live iiko
// install (see iikoClient.saveEmployee's doc comment) — login/PIN are
// resolved dynamically via pickField() against the employee's own existing
// keys, same pattern as getWarehouse()/getRiskyOperations(). If iiko
// silently accepts the save but the new password doesn't work in practice,
// the likely fix is sending sha1(password) instead of plaintext (getToken()
// shows iiko's /resto/api/auth already requires a SHA1 password hash).
const LOGIN_FIELD_PATTERNS = [/^login$/i];
const PIN_FIELD_PATTERNS = [/^pinCode$/i, /^pin$/i, /^personalKeyboardPassword$/i];
const PASSWORD_FIELD_DEFAULT = "password";

// Security gate (added after review): this is the app's first MUTATING iiko
// route, and requireAuth only proves "some valid iiko login is behind this
// session" — it says nothing about whether that account should be allowed
// to overwrite a DIFFERENT employee's credentials. iiko's own server-side
// permission model for employees/save is unknown/unconfirmed from here, so
// this app-level role check is a defense-in-depth gate, not a replacement
// for iiko's own enforcement. Fails CLOSED: if the acting account's role
// can't be matched against a known admin-like name, the edit is refused
// rather than silently allowed — if your iiko install names its admin role
// something not covered here, add it to ADMIN_ROLE_PATTERNS.
const ADMIN_ROLE_PATTERNS = [
  /admin/i, /администратор/i, /manager/i, /менеджер/i, /управля/i, /owner/i, /владелец/i, /директор/i,
];

async function assertActingUserIsAdmin(items, actingLogin) {
  const me = items.find((e) => e.login === actingLogin);
  const roleName = (me && (me.mainRoleName || me.roleName || (Array.isArray(me.roles) ? me.roles.join(", ") : ""))) || "";
  const isAdmin = !!me && ADMIN_ROLE_PATTERNS.some((re) => re.test(roleName));
  if (!isAdmin) {
    throw new Error(
      `Редактирование учётных данных сотрудников доступно только ролям с правами администратора. ` +
      `Текущая роль в iiko: ${roleName || "не определена"}.`
    );
  }
}

async function updateEmployeeCredentials(client, employeeId, actingLogin, { login, password, pin } = {}) {
  const raw = await client.getEmployees();
  const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];

  await assertActingUserIsAdmin(items, actingLogin);

  const existing = items.find((e) => String(e.id) === String(employeeId));
  if (!existing) throw new Error("Сотрудник с указанным id не найден в iiko");

  const keys = Object.keys(existing);
  const loginField = pickField(keys, LOGIN_FIELD_PATTERNS) || "login";
  const pinField = pickField(keys, PIN_FIELD_PATTERNS) || "pinCode";

  const payload = { ...existing };
  if (login) payload[loginField] = login;
  if (password) payload[PASSWORD_FIELD_DEFAULT] = password;
  if (pin) payload[pinField] = pin;

  // NOTE: the iiko response (`saved`) is deliberately NOT included in this
  // return value. iiko upsert endpoints commonly echo back the persisted
  // entity, which would put the plaintext password/PIN just submitted into
  // the HTTP response body (visible in DevTools/proxy logs/HAR exports) —
  // caught in review. Callers only need to know the save succeeded.
  await client.saveEmployee(payload, [password, pin].filter(Boolean));
  return {
    ok: true,
    id: employeeId,
    fieldsUsed: { loginField, pinField, passwordField: PASSWORD_FIELD_DEFAULT },
  };
}

// --- Employee attendance log ---
//
// Endpoint/response shape is a GUESS (see iikoClient.getAttendance's doc
// comment) — degrades to {available:false} on any mismatch rather than
// crashing the page, same convention as every other optional metric here.
// Ordered by priority (pickField returns the first pattern that matches any
// field name). Kept anchored/specific — greedy catch-alls like /In$/ would
// wrongly grab "login"; unrecognised layouts fall through to value-based
// datetime detection below instead.
const ATT_EMPLOYEE_ID_PATTERNS = [/^employeeId$/i, /^employee\.id$/i, /^personId$/i, /^userId$/i, /^workerId$/i, /^worker$/i, /^employee$/i];
const ATT_EMPLOYEE_NAME_PATTERNS = [/^employeeName$/i, /^fullName$/i, /^fio$/i, /^personName$/i, /^workerName$/i, /^name$/i];
const ATT_CLOCKIN_PATTERNS = [/^comeTime$/i, /^dateFrom$/i, /^clockIn$/i, /^startTime$/i, /^openTime$/i, /^workStart$/i, /^shiftStart$/i, /^timeIn$/i, /^checkIn$/i, /^beginTime$/i, /^attendanceFrom$/i, /^from$/i];
const ATT_CLOCKOUT_PATTERNS = [/^leaveTime$/i, /^dateTo$/i, /^clockOut$/i, /^endTime$/i, /^closeTime$/i, /^workEnd$/i, /^shiftEnd$/i, /^timeOut$/i, /^checkOut$/i, /^attendanceTo$/i, /^to$/i];

// iiko's attendance payload shape isn't guaranteed — accept the common
// wrapper keys as well as a bare array.
function extractAttendanceRows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const wrappers = ["items", "employeeAttendances", "attendances", "attendance", "data", "response", "list", "records", "result"];
  for (const w of wrappers) {
    if (Array.isArray(data[w])) return data[w];
    if (data[w] && typeof data[w] === "object" && Array.isArray(data[w].attendance)) return data[w].attendance;
  }
  return [];
}

function looksLikeDateTime(v) {
  if (v == null || v === "") return false;
  if (typeof v === "number") return v > 1e11 && v < 2e13; // plausible epoch-millis
  const s = String(v);
  // Require a real calendar date (YYYY-MM-DD / DD.MM.YYYY) or a clock time
  // (HH:MM). A bare id like "emp-1" has a dash but is NOT a datetime.
  if (!/\d{4}-\d{2}-\d{2}/.test(s) && !/\d{2}\.\d{2}\.\d{4}/.test(s) && !/\d{1,2}:\d{2}/.test(s)) return false;
  return !isNaN(Date.parse(s));
}

async function getAttendance(client, from, to, employeeIdFilter) {
  const res = await safe(() => client.getAttendance(from, to));
  if (!res.ok) return { available: false, error: res.error, records: [] };
  const rows = extractAttendanceRows(res.value);
  if (!rows.length) return { available: true, records: [], source: "live" };

  const keys = Object.keys(rows[0] || {});
  let inField = pickField(keys, ATT_CLOCKIN_PATTERNS);
  let outField = pickField(keys, ATT_CLOCKOUT_PATTERNS);

  // Value-based fallback: when field names don't match, sniff which columns
  // actually hold datetime values (≥60% of sampled rows). Earliest → clock-in,
  // next → clock-out. This is what makes the log survive naming differences
  // between iiko builds without needing to hardcode every possible field name.
  if (!inField || !outField) {
    const dtFields = keys.filter((k) => {
      let hits = 0, seen = 0;
      for (const row of rows.slice(0, 20)) {
        if (row[k] != null && row[k] !== "") { seen++; if (looksLikeDateTime(row[k])) hits++; }
      }
      return seen > 0 && hits / seen >= 0.6;
    });
    if (!inField && dtFields.length >= 1) inField = dtFields[0];
    if (!outField && dtFields.length >= 2) outField = dtFields.find((f) => f !== inField) || null;
  }

  if (!inField) {
    // Diagnostic: surface the real field names so a remaining mismatch is a
    // one-line pattern fix rather than a dead end.
    return {
      available: false,
      error: "Сервер iiko вернул данные о явках в неожиданном формате. Обнаруженные поля: " + (keys.join(", ") || "нет полей"),
      records: [],
    };
  }
  const empIdField = pickField(keys, ATT_EMPLOYEE_ID_PATTERNS);
  const empNameField = pickField(keys, ATT_EMPLOYEE_NAME_PATTERNS);

  const dirRes = await safe(() => client.getEmployees());
  const nameById = {};
  if (dirRes.ok) {
    const items = Array.isArray(dirRes.value) ? dirRes.value : (dirRes.value && dirRes.value.items) || [];
    items.forEach((e) => {
      nameById[e.id] = [e.lastName, e.firstName].filter(Boolean).join(" ") || e.name || e.login || "—";
    });
  }

  const toMs = (v) => (typeof v === "number" ? v : Date.parse(v));
  let records = rows.map((r) => {
    const empId = empIdField ? r[empIdField] : null;
    const clockIn = inField ? r[inField] : null;
    const clockOut = outField ? r[outField] : null;
    const inMs = clockIn != null ? toMs(clockIn) : NaN;
    const outMs = clockOut != null ? toMs(clockOut) : NaN;
    const hours = !isNaN(inMs) && !isNaN(outMs) && outMs >= inMs ? +((outMs - inMs) / 3600000).toFixed(2) : null;
    const inlineName = empNameField ? r[empNameField] : null;
    return {
      employeeId: empId,
      employeeName: inlineName || nameById[empId] || "Не указано",
      date: !isNaN(inMs) ? new Date(inMs).toISOString().slice(0, 10) : clockIn ? String(clockIn).slice(0, 10) : null,
      clockIn,
      clockOut,
      hours,
    };
  });
  if (employeeIdFilter) {
    records = records.filter((r) => String(r.employeeId) === String(employeeIdFilter));
  }
  records.sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : (a.date || "") > (b.date || "") ? -1 : 0));
  return { available: true, records, source: "live" };
}

// --- Guest count analytics ---
//
// Depends on the same dynamically-resolved GuestNum-family field as
// getSummary(); degrades to {available:false} if this iiko install doesn't
// expose it (medium confidence per the plan's API confidence table).
async function getGuestAnalytics(client, customFrom, customTo) {
  const colsRes = await safe(() => getSalesColumns(client));
  const guestField = colsRes.ok ? pickField(colsRes.value.names, GUEST_FIELD_PATTERNS) : null;
  if (!guestField) {
    return {
      available: false,
      error: "Сервер iiko не предоставляет поле числа гостей в отчёте по продажам",
    };
  }

  const today = todayRange();
  const week = weekToDateRange(0);
  const month = monthToDateRange(0);
  const custom = customFrom && customTo ? { from: customFrom, to: exclusiveTo(customTo) } : null;

  const ranges = [today, week, month, ...(custom ? [custom] : [])];
  const results = await Promise.allSettled(ranges.map((r) => client.getOlapSales(r.from, r.to, [guestField])));

  function sumGuests(res) {
    if (res.status !== "fulfilled" || !res.value) return { guests: 0, days: new Set() };
    let guests = 0;
    const days = new Set();
    client.parseOlap(res.value).forEach((r) => {
      guests += parseFloat(r[guestField] || 0);
      const d = (r["OpenDate.Typed"] || "").slice(0, 10);
      if (d) days.add(d);
    });
    return { guests, days };
  }

  const todayAgg = sumGuests(results[0]);
  const weekAgg = sumGuests(results[1]);
  const monthAgg = sumGuests(results[2]);
  const customAgg = custom ? sumGuests(results[3]) : null;

  const trendRes = await safe(() => client.getOlapSales(month.from, month.to, [guestField]));
  const byDate = {};
  if (trendRes.ok) {
    client.parseOlap(trendRes.value).forEach((r) => {
      const d = (r["OpenDate.Typed"] || "").slice(0, 10);
      if (!d) return;
      byDate[d] = (byDate[d] || 0) + parseFloat(r[guestField] || 0);
    });
  }
  const labels = Object.keys(byDate).sort();
  const avg = (agg) => (agg.days.size > 0 ? +(agg.guests / agg.days.size).toFixed(1) : 0);

  return {
    available: true,
    today: { total: Math.round(todayAgg.guests) },
    week: { total: Math.round(weekAgg.guests), avgPerDay: avg(weekAgg) },
    month: { total: Math.round(monthAgg.guests), avgPerDay: avg(monthAgg) },
    custom: customAgg ? { total: Math.round(customAgg.guests), avgPerDay: avg(customAgg) } : null,
    trend: { labels, guests: labels.map((d) => Math.round(byDate[d])) },
    source: "live",
  };
}

// --- Average check (avg ticket) analytics ---
//
// Needs no new iiko API surface — reuses getOlapSales()/aggregateSales()
// already relied on elsewhere, just with calendar-aligned date ranges.
async function getAverageCheckAnalytics(client) {
  const today = todayRange();
  const yesterday = daysRange(1, 1);
  const week = weekToDateRange(0);
  const prevWeek = weekToDateRange(1);
  const month = monthToDateRange(0);
  const prevMonth = monthToDateRange(1);

  const ranges = [today, yesterday, week, prevWeek, month, prevMonth];
  const results = await Promise.allSettled(ranges.map((r) => client.getOlapSales(r.from, r.to)));

  function avgCheckFor(res) {
    if (res.status !== "fulfilled" || !res.value) return 0;
    const { revenue, orders } = aggregateSales(client, res.value);
    return orders > 0 ? +(revenue / orders).toFixed(2) : 0;
  }

  const todayAvg = avgCheckFor(results[0]);
  const yesterdayAvg = avgCheckFor(results[1]);
  const weekAvg = avgCheckFor(results[2]);
  const prevWeekAvg = avgCheckFor(results[3]);
  const monthAvg = avgCheckFor(results[4]);
  const prevMonthAvg = avgCheckFor(results[5]);

  return {
    today: { avgCheck: todayAvg, changePct: pctChange(todayAvg, yesterdayAvg) },
    week: { avgCheck: weekAvg, changePct: pctChange(weekAvg, prevWeekAvg) },
    month: { avgCheck: monthAvg, changePct: pctChange(monthAvg, prevMonthAvg) },
    source: "live",
  };
}

// --- Average-check trend (#10): daily average ticket over a rolling window ---
//
// Same avg-check definition as getAverageCheckAnalytics (revenue / DishAmountInt),
// just resolved per calendar day so the two views never disagree. Reuses the
// existing getOlapSales() call — no new iiko API surface.
async function getAverageCheckTrend(client, days = 30) {
  const { from, to } = daysRange(days);
  const raw = await client.getOlapSales(from, to);
  const byDate = {};
  client.parseOlap(raw).forEach((r) => {
    const d = (r["OpenDate.Typed"] || "").slice(0, 10);
    if (!d) return;
    if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0 };
    byDate[d].revenue += parseFloat(r["DishSumInt"] || 0);
    byDate[d].orders += parseInt(r["DishAmountInt"] || 0, 10);
  });
  const labels = Object.keys(byDate).sort();
  const avgCheck = labels.map((d) => (byDate[d].orders > 0 ? +(byDate[d].revenue / byDate[d].orders).toFixed(2) : 0));
  const totalOrders = labels.reduce((s, d) => s + byDate[d].orders, 0);
  const totalRevenue = labels.reduce((s, d) => s + byDate[d].revenue, 0);
  return {
    labels,
    avgCheck,
    overallAvg: totalOrders > 0 ? +(totalRevenue / totalOrders).toFixed(2) : 0,
    source: "live",
  };
}

// --- Year-over-year (#9/#48): current N-day window vs the same window a year ago ---
async function getYearOverYear(client, days = 30) {
  const cur = daysRange(days);
  const prevYear = daysRange(days, 365);
  const [curRes, prevRes] = await Promise.allSettled([
    client.getOlapSales(cur.from, cur.to),
    client.getOlapSales(prevYear.from, prevYear.to),
  ]);
  const agg = (res) => (res.status === "fulfilled" && res.value ? aggregateSales(client, res.value) : { revenue: 0, orders: 0 });
  const curAgg = agg(curRes);
  const prevAgg = agg(prevRes);
  return {
    days,
    current: { revenue: +curAgg.revenue.toFixed(2), orders: curAgg.orders, from: cur.from, to: cur.to },
    lastYear: { revenue: +prevAgg.revenue.toFixed(2), orders: prevAgg.orders, from: prevYear.from, to: prevYear.to },
    revenueChangePct: pctChange(curAgg.revenue, prevAgg.revenue),
    ordersChangePct: pctChange(curAgg.orders, prevAgg.orders),
    source: "live",
  };
}

// --- Plan vs fact for an arbitrary period (#1) ---
// iiko carries no revenue "plan" of its own, so the target is supplied by the
// operator (query param). Everything else is real OLAP fact for [from, to].
async function getSalesPlanFact(client, from, to, plan) {
  const raw = await client.getOlapSales(from, exclusiveTo(to));
  const { revenue, orders } = aggregateSales(client, raw);
  const fact = +revenue.toFixed(2);
  const planNum = Number(plan) > 0 ? Number(plan) : 0;
  return {
    from,
    to,
    plan: planNum,
    fact,
    orders,
    completionPct: planNum > 0 ? +((fact / planNum) * 100).toFixed(1) : null,
    remaining: planNum > 0 ? +(planNum - fact).toFixed(2) : null,
    source: "live",
  };
}

// --- Worst / slowest-selling dishes (#13) ---
// Same SALES top-dishes report, just surfaced from the bottom: dishes that
// actually sold (amount > 0) but bring the least revenue — candidates to cut
// or re-price. Zero-sale dishes are excluded (they'd need a separate menu
// dictionary to enumerate, which this report doesn't carry).
async function getWorstDishes(client, days = 30) {
  const { from, to } = daysRange(days);
  const olapRaw = await client.getOlapTopDishes(from, to);
  const rows = client.parseOlap(olapRaw)
    .map((r) => ({
      name: r["DishName"] || "—",
      category: r["DishGroup"] || "",
      amount: parseInt(r["DishAmountInt"] || 0, 10),
      revenue: +parseFloat(r["DishSumInt"] || 0).toFixed(2),
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => a.revenue - b.revenue);
  return { dishes: rows.slice(0, 20), source: "live" };
}

// --- Dish margin: price vs cost (#14) ---
// Needs a cost-price field, whose name varies per install (like every other
// OLAP field here) — resolved dynamically. If the SALES report on this server
// doesn't expose one, degrades to { available:false } rather than guessing.
const DISH_COST_FIELD_PATTERNS = [
  /^ProductCostBase\.ProductCost$/i,
  /^DishCostSum$/i,
  /^ProductCost$/i,
  /ProductCost/i,
  /DishCost/i,
  /CostSum$/i,
];
async function getDishMargin(client, days = 30) {
  const colsRes = await safe(() => getSalesColumns(client));
  const costField = colsRes.ok ? pickField(colsRes.value.names, DISH_COST_FIELD_PATTERNS) : null;
  if (!costField) {
    return {
      available: false,
      error: "Сервер iiko не предоставляет поле себестоимости в отчёте по продажам",
    };
  }
  const { from, to } = daysRange(days);
  const raw = await client.getOlapDishCost(from, to, costField);
  const dishes = client.parseOlap(raw)
    .map((r) => {
      const revenue = +parseFloat(r["DishSumInt"] || 0).toFixed(2);
      const cost = +parseFloat(r[costField] || 0).toFixed(2);
      const amount = parseInt(r["DishAmountInt"] || 0, 10);
      const margin = +(revenue - cost).toFixed(2);
      const marginPct = revenue > 0 ? +((margin / revenue) * 100).toFixed(1) : 0;
      return { name: r["DishName"] || "—", category: r["DishGroup"] || "", amount, revenue, cost, margin, marginPct };
    })
    .filter((d) => d.revenue > 0)
    .sort((a, b) => a.marginPct - b.marginPct);
  return { available: true, dishes, source: "live" };
}

// --- Cancellation / write-off reasons breakdown (#8) ---
// Reuses the same SALES report the "risky operations" page already queries,
// narrowed to written-off dishes grouped by their deletion reason/comment
// (field name varies per install; if absent, everything collapses into a
// single "reason not specified" bucket but totals are still shown).
async function getCancellationReasons(client, days = 30) {
  const { from, to } = daysRange(days);
  const colsRes = await safe(() => getSalesColumns(client));
  if (!colsRes.ok) return { available: false, error: colsRes.error };
  const { names } = colsRes.value;

  const DELETED = "DeletedWithWriteoff";
  const DISH_NAME = "DishName";
  const DISH_SUM = "DishSumInt";
  const reasonField = pickField(names, [
    /DeletionComment/i,
    /RemovalComment/i,
    /DeleteComment/i,
    /DeletionReason/i,
    /RemovalType/i,
    /StornoReason/i,
  ]);

  const groupBy = [DELETED, DISH_NAME, reasonField].filter(Boolean);
  const res = await safe(() => client.getOlapRiskyOps(from, to, groupBy, [DISH_SUM]));
  if (!res.ok) return { available: false, error: res.error };

  const byReason = {};
  let totalCount = 0;
  let totalSum = 0;
  client.parseOlap(res.value).forEach((r) => {
    const flag = String(r[DELETED] || "").toUpperCase();
    const isDeleted = flag && flag !== "NOT_DELETED" && flag !== "FALSE" && flag !== "0";
    if (!isDeleted) return;
    const reason = (reasonField && String(r[reasonField] || "").trim()) || "Причина не указана";
    const sum = parseFloat(r[DISH_SUM] || 0);
    if (!byReason[reason]) byReason[reason] = { reason, count: 0, sum: 0 };
    byReason[reason].count += 1;
    byReason[reason].sum += sum;
    totalCount += 1;
    totalSum += sum;
  });

  const reasons = Object.values(byReason)
    .map((r) => ({ reason: r.reason, count: r.count, sum: +r.sum.toFixed(2) }))
    .sort((a, b) => b.sum - a.sum);

  return {
    available: true,
    reasons,
    totalCount,
    totalSum: +totalSum.toFixed(2),
    hasReasonField: !!reasonField,
    source: "live",
  };
}

// --- Per-shift (day-part) efficiency (#16) ---
// Buckets the hourly SALES report into morning/day/evening/night shifts and
// reports revenue, order count and average check per shift. Reuses the same
// getOlapHourly() call the hourly-activity chart already uses.
function shiftKeyForHour(h) {
  if (h >= 6 && h < 11) return "morning";
  if (h >= 11 && h < 16) return "day";
  if (h >= 16 && h < 22) return "evening";
  return "night";
}
const SHIFT_LABELS = {
  morning: "Утро (06:00–11:00)",
  day: "День (11:00–16:00)",
  evening: "Вечер (16:00–22:00)",
  night: "Ночь (22:00–06:00)",
};
async function getShiftEfficiency(client, days = 30) {
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapHourly(from, to));
  if (!res.ok) return { available: false, error: res.error, shifts: [] };
  const acc = { morning: { revenue: 0, orders: 0 }, day: { revenue: 0, orders: 0 }, evening: { revenue: 0, orders: 0 }, night: { revenue: 0, orders: 0 } };
  client.parseOlap(res.value).forEach((r) => {
    let h = parseInt(r["HourOpen"], 10);
    if (Number.isNaN(h)) { const raw = r["HourOpen"]; h = raw != null ? parseInt(String(raw).slice(0, 2), 10) : NaN; }
    if (Number.isNaN(h) || h < 0 || h > 23) return;
    const k = shiftKeyForHour(h);
    acc[k].revenue += parseFloat(r["DishSumInt"] || 0);
    acc[k].orders += parseInt(r["DishAmountInt"] || 0, 10);
  });
  const shifts = Object.keys(SHIFT_LABELS).map((k) => ({
    key: k,
    label: SHIFT_LABELS[k],
    revenue: +acc[k].revenue.toFixed(2),
    orders: acc[k].orders,
    avgCheck: acc[k].orders > 0 ? +(acc[k].revenue / acc[k].orders).toFixed(2) : 0,
  }));
  return { available: true, shifts, source: "live" };
}

// --- Attendance anomalies: short shifts / overtime (#17) ---
// There's no shift schedule in the data to compute true lateness against, so
// this honestly flags unusually short (<4h) and long (>12h) shifts plus total
// hours — built on top of the same getAttendance() parser (so it inherits its
// live-server robustness and degradation).
const SHIFT_SHORT_HOURS = 4;
const SHIFT_LONG_HOURS = 12;
async function getAttendanceAnomalies(client, from, to) {
  const att = await getAttendance(client, from, to, null);
  if (!att.available) return { available: false, error: att.error, flagged: [] };
  const withHours = att.records.filter((r) => r.hours != null);
  const flagged = withHours
    .filter((r) => r.hours < SHIFT_SHORT_HOURS || r.hours > SHIFT_LONG_HOURS)
    .map((r) => ({ ...r, flag: r.hours < SHIFT_SHORT_HOURS ? "short" : "long" }));
  const totalHours = +withHours.reduce((s, r) => s + r.hours, 0).toFixed(1);
  return {
    available: true,
    totalShifts: att.records.length,
    shortCount: flagged.filter((f) => f.flag === "short").length,
    longCount: flagged.filter((f) => f.flag === "long").length,
    totalHours,
    avgHours: withHours.length ? +(totalHours / withHours.length).toFixed(1) : 0,
    flagged,
    source: "live",
  };
}

// --- Repeat dishes within a single order (#7) ---
// Needs an order-identifier that this install allows grouping by (UniqOrderId
// is explicitly non-groupable on some installs — see getRiskyOperations note).
// Discovered dynamically; degrades to { available:false } when unsupported.
const ORDER_NUM_FIELD_PATTERNS = [/^OrderNum$/i, /^OrderNumber$/i, /^Order\.Num$/i, /^Order\.Number$/i, /^SessionNum$/i];
async function getDishRepeats(client, days = 30) {
  const colsRes = await safe(() => getSalesColumns(client));
  const orderField = colsRes.ok ? pickField(colsRes.value.names, ORDER_NUM_FIELD_PATTERNS) : null;
  if (!orderField) {
    return { available: false, error: "Сервер iiko не отдаёт номер заказа в отчёте — повторы блюд в одном чеке недоступны", dishes: [] };
  }
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapDishRepeats(from, to, orderField));
  if (!res.ok) return { available: false, error: res.error, dishes: [] };

  const byDish = {};
  client.parseOlap(res.value).forEach((r) => {
    const qty = parseFloat(r["DishAmountInt"] || 0);
    if (qty <= 1) return; // "repeat" = same dish more than once in one order
    const name = r["DishName"] || "—";
    if (!byDish[name]) byDish[name] = { name, repeatOrders: 0, extraUnits: 0 };
    byDish[name].repeatOrders += 1;
    byDish[name].extraUnits += qty - 1;
  });
  const dishes = Object.values(byDish)
    .map((d) => ({ name: d.name, repeatOrders: d.repeatOrders, extraUnits: Math.round(d.extraUnits) }))
    .sort((a, b) => b.repeatOrders - a.repeatOrders)
    .slice(0, 20);
  return { available: true, dishes, source: "live" };
}

// ========================= Wave 4: advanced analytics =========================

// --- #2 ABC-XYZ: revenue class (ABC) × demand-stability class (XYZ) ---
async function getAbcXyz(client, days = 30) {
  const { from, to } = daysRange(days);
  const raw = await safe(() => client.getOlapDishByDate(from, to));
  if (!raw.ok) return { available: false, error: raw.error, dishes: [] };
  const byDish = {};
  const allDates = new Set();
  client.parseOlap(raw.value).forEach((r) => {
    const name = r["DishName"] || "—";
    const d = (r["OpenDate.Typed"] || "").slice(0, 10);
    if (d) allDates.add(d);
    const qty = parseFloat(r["DishAmountInt"] || 0);
    const rev = parseFloat(r["DishSumInt"] || 0);
    if (!byDish[name]) byDish[name] = { revenue: 0, byDate: {} };
    byDish[name].revenue += rev;
    if (d) byDish[name].byDate[d] = (byDish[name].byDate[d] || 0) + qty;
  });
  const dates = Array.from(allDates);
  const rows = Object.entries(byDish).map(([name, v]) => {
    const qtys = dates.map((d) => v.byDate[d] || 0);
    const mean = qtys.length ? qtys.reduce((s, x) => s + x, 0) / qtys.length : 0;
    const variance = qtys.length ? qtys.reduce((s, x) => s + (x - mean) ** 2, 0) / qtys.length : 0;
    const cov = mean > 0 ? Math.sqrt(variance) / mean : 0;
    const xyz = cov <= 0.1 ? "X" : cov <= 0.25 ? "Y" : "Z";
    return { name, revenue: +v.revenue.toFixed(2), cov: +(cov * 100).toFixed(1), xyz };
  }).sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  let cum = 0;
  rows.forEach((r) => { cum += r.revenue; const p = total > 0 ? (cum / total) * 100 : 0; r.abc = p <= 80 ? "A" : p <= 95 ? "B" : "C"; r.combo = r.abc + r.xyz; });
  return { available: true, dishes: rows, daysObserved: dates.length, source: "live" };
}

// --- #11 Menu engineering: popularity × profitability quadrant ---
async function getMenuEngineering(client, days = 30) {
  const marginData = await getDishMargin(client, days);
  if (!marginData.available) return { available: false, error: marginData.error, dishes: [] };
  const dishes = marginData.dishes;
  if (!dishes.length) return { available: true, dishes: [], counts: { star: 0, plowhorse: 0, puzzle: 0, dog: 0 }, source: "live" };
  const avgPopularity = dishes.reduce((s, d) => s + d.amount, 0) / dishes.length;
  const avgMargin = dishes.reduce((s, d) => s + d.marginPct, 0) / dishes.length;
  const counts = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
  const QLABEL = { star: "Звезда", plowhorse: "Рабочая лошадка", puzzle: "Загадка", dog: "Собака" };
  const withClass = dishes.map((d) => {
    const popular = d.amount >= avgPopularity;
    const profitable = d.marginPct >= avgMargin;
    const q = popular && profitable ? "star" : popular ? "plowhorse" : profitable ? "puzzle" : "dog";
    counts[q]++;
    return { name: d.name, amount: d.amount, revenue: d.revenue, marginPct: d.marginPct, quadrant: q, quadrantLabel: QLABEL[q] };
  });
  return { available: true, dishes: withClass, counts, avgPopularity: +avgPopularity.toFixed(1), avgMargin: +avgMargin.toFixed(1), source: "live" };
}

// --- #12 Dish combinations frequently ordered together ---
async function getDishCombos(client, days = 30) {
  const colsRes = await safe(() => getSalesColumns(client));
  const orderField = colsRes.ok ? pickField(colsRes.value.names, ORDER_NUM_FIELD_PATTERNS) : null;
  if (!orderField) return { available: false, error: "Сервер iiko не отдаёт номер заказа — анализ сочетаний недоступен", pairs: [] };
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapDishRepeats(from, to, orderField));
  if (!res.ok) return { available: false, error: res.error, pairs: [] };
  const orders = {};
  client.parseOlap(res.value).forEach((r) => {
    const oid = r[orderField];
    const name = r["DishName"];
    if (oid == null || !name) return;
    if (!orders[oid]) orders[oid] = new Set();
    orders[oid].add(name);
  });
  const pairCount = {};
  Object.values(orders).forEach((set) => {
    const arr = Array.from(set);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = [arr[i], arr[j]].sort().join(" + ");
        pairCount[key] = (pairCount[key] || 0) + 1;
      }
    }
  });
  const pairs = Object.entries(pairCount).map(([pair, count]) => ({ pair, count })).sort((a, b) => b.count - a.count).slice(0, 20);
  return { available: true, pairs, ordersAnalyzed: Object.keys(orders).length, source: "live" };
}

// --- #18 Employee gamification: points + badges over sales performance ---
async function getEmployeeGamification(client, days = 30) {
  const perf = await getEmployeePerformance(client, days);
  if (!perf.available) return { available: false, error: perf.error, players: [] };
  const emps = perf.employees;
  if (!emps.length) return { available: true, players: [], source: "live" };
  const maxRev = Math.max(...emps.map((e) => e.revenue));
  const maxAvg = Math.max(...emps.map((e) => e.avgCheck));
  const avgOrders = emps.reduce((s, x) => s + x.orders, 0) / emps.length;
  const players = emps.map((e, i) => {
    const points = (maxRev > 0 ? Math.round((e.revenue / maxRev) * 600) : 0) + (maxAvg > 0 ? Math.round((e.avgCheck / maxAvg) * 400) : 0);
    const badges = [];
    if (i === 0) badges.push("Лидер по выручке");
    if (maxAvg > 0 && e.avgCheck === maxAvg) badges.push("Лучший средний чек");
    if (e.orders >= avgOrders) badges.push("Выше среднего по чекам");
    return { name: e.name, revenue: e.revenue, orders: e.orders, avgCheck: e.avgCheck, points, badges };
  }).sort((a, b) => b.points - a.points).map((p, i) => ({ ...p, rank: i + 1 }));
  return { available: true, players, source: "live" };
}

// --- #28 Simplified P&L: revenue − estimated COGS (write-offs) = gross profit ---
async function getSimplePnl(client, days = 30) {
  const { from, to } = daysRange(days);
  const salesRes = await safe(() => client.getOlapSales(from, to));
  const revenue = salesRes.ok ? +aggregateSales(client, salesRes.value).revenue.toFixed(2) : 0;
  const wh = await getWarehouse(client, days);
  const cogs = wh.available ? +(wh.totalCost || 0).toFixed(2) : null;
  const grossProfit = cogs != null ? +(revenue - cogs).toFixed(2) : null;
  const grossMarginPct = cogs != null && revenue > 0 ? +((grossProfit / revenue) * 100).toFixed(1) : null;
  return {
    available: salesRes.ok,
    error: salesRes.ok ? undefined : salesRes.error,
    revenue,
    cogs,
    cogsAvailable: wh.available,
    grossProfit,
    grossMarginPct,
    note: "Себестоимость оценивается по складским списаниям iiko — это не полноценный бухгалтерский P&L",
    source: "live",
  };
}

// --- #5 Register/cashier heatmap: revenue by cashier × hour of day ---
async function getRegisterHeatmap(client, days = 30) {
  const colsRes = await safe(() => getSalesColumns(client));
  if (!colsRes.ok) return { available: false, error: colsRes.error, cashiers: [] };
  const cashierField = pickField(colsRes.value.names, CASHIER_FIELD_PATTERNS) || pickField(colsRes.value.names, WAITER_FIELD_PATTERNS);
  if (!cashierField) return { available: false, error: "Сервер iiko не предоставляет поле кассира/официанта", cashiers: [] };
  const { from, to } = daysRange(days);
  const res = await safe(() => client.getOlapCashierHourly(from, to, cashierField));
  if (!res.ok) return { available: false, error: res.error, cashiers: [] };
  const byCashier = {};
  client.parseOlap(res.value).forEach((r) => {
    const name = r[cashierField];
    if (!name) return;
    let h = parseInt(r["HourOpen"], 10);
    if (Number.isNaN(h)) { const raw = r["HourOpen"]; h = raw != null ? parseInt(String(raw).slice(0, 2), 10) : NaN; }
    if (Number.isNaN(h) || h < 0 || h > 23) return;
    if (!byCashier[name]) byCashier[name] = Array.from({ length: 24 }, () => 0);
    byCashier[name][h] += parseFloat(r["DishSumInt"] || 0);
  });
  const cashiers = Object.entries(byCashier)
    .map(([name, hours]) => ({ name, hours: hours.map((x) => +x.toFixed(0)), total: +hours.reduce((s, x) => s + x, 0).toFixed(0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
  const maxCell = Math.max(1, ...cashiers.flatMap((c) => c.hours));
  return { available: true, cashiers, maxCell, source: "live" };
}

// ================= Wave 5: module-dependent (speculative) reports =================
// Each depends on an iiko module/field that may not exist on a given install.
// They discover the needed field and honestly degrade to { available:false,
// requiresModule } rather than fabricating numbers. On a server that DOES have
// the module, they return real aggregates.

// --- #19 Tips by waiter ---
const TIP_FIELD_PATTERNS = [/^Tips?Sum/i, /Gratuity/i, /Чаев/i, /^Tips?$/i];
async function getTips(client, days = 30) {
  const { from, to } = daysRange(days);
  const colsRes = await safe(() => getSalesColumns(client));
  const tipField = colsRes.ok ? pickField(colsRes.value.names, TIP_FIELD_PATTERNS) : null;
  if (!tipField) return { available: false, requiresModule: "учёт чаевых в iiko", error: "Поле чаевых не найдено в отчёте по продажам", waiters: [] };
  const waiterField = colsRes.ok ? pickField(colsRes.value.names, WAITER_FIELD_PATTERNS) : null;
  const res = await safe(() => client.getOlapSalesCustom(from, to, [waiterField].filter(Boolean), [tipField]));
  if (!res.ok) return { available: false, requiresModule: "учёт чаевых в iiko", error: res.error, waiters: [] };
  const byWaiter = {};
  let total = 0;
  client.parseOlap(res.value).forEach((r) => {
    const w = (waiterField && r[waiterField]) || "Не указано";
    const tip = parseFloat(r[tipField] || 0);
    byWaiter[w] = (byWaiter[w] || 0) + tip;
    total += tip;
  });
  const waiters = Object.entries(byWaiter).map(([name, sum]) => ({ name, tips: +sum.toFixed(2) })).sort((a, b) => b.tips - a.tips);
  return { available: true, total: +total.toFixed(2), waiters, source: "live" };
}

// --- #22 Average check by guest type ---
const GUEST_TYPE_FIELD_PATTERNS = [/^GuestType/i, /^OrderCategory/i, /ТипГост/i, /GuestCategory/i];
async function getAvgCheckByGuestType(client, days = 30) {
  const { from, to } = daysRange(days);
  const colsRes = await safe(() => getSalesColumns(client));
  const typeField = colsRes.ok ? pickField(colsRes.value.names, GUEST_TYPE_FIELD_PATTERNS) : null;
  if (!typeField) return { available: false, requiresModule: "категории гостей в iiko", error: "Поле типа гостя не найдено", types: [] };
  const res = await safe(() => client.getOlapSalesCustom(from, to, [typeField], ["DishSumInt", "DishAmountInt"]));
  if (!res.ok) return { available: false, requiresModule: "категории гостей в iiko", error: res.error, types: [] };
  const byType = {};
  client.parseOlap(res.value).forEach((r) => {
    const t = r[typeField] || "Не указано";
    if (!byType[t]) byType[t] = { revenue: 0, orders: 0 };
    byType[t].revenue += parseFloat(r["DishSumInt"] || 0);
    byType[t].orders += parseInt(r["DishAmountInt"] || 0, 10);
  });
  const types = Object.entries(byType).map(([name, v]) => ({ name, revenue: +v.revenue.toFixed(2), orders: v.orders, avgCheck: v.orders > 0 ? +(v.revenue / v.orders).toFixed(2) : 0 })).sort((a, b) => b.revenue - a.revenue);
  return { available: true, types, source: "live" };
}

// --- #21 Guest segmentation: new vs returning (loyalty) ---
const GUEST_CARD_FIELD_PATTERNS = [/LoyaltyCard/i, /GuestCard/i, /CardNumber/i, /Guest\.?Id/i, /ClientId/i];
async function getGuestSegmentation(client, days = 30) {
  const { from, to } = daysRange(days);
  const colsRes = await safe(() => getSalesColumns(client));
  const cardField = colsRes.ok ? pickField(colsRes.value.names, GUEST_CARD_FIELD_PATTERNS) : null;
  if (!cardField) return { available: false, requiresModule: "модуль лояльности iiko", error: "Идентификатор гостя/карты не найден" };
  const res = await safe(() => client.getOlapSalesCustom(from, to, [cardField, "OpenDate.Typed"], ["DishSumInt"]));
  if (!res.ok) return { available: false, requiresModule: "модуль лояльности iiko", error: res.error };
  const visitsByCard = {};
  client.parseOlap(res.value).forEach((r) => {
    const card = r[cardField];
    if (!card) return;
    const d = (r["OpenDate.Typed"] || "").slice(0, 10);
    if (!visitsByCard[card]) visitsByCard[card] = new Set();
    if (d) visitsByCard[card].add(d);
  });
  const cards = Object.values(visitsByCard);
  const returning = cards.filter((s) => s.size > 1).length;
  const newGuests = cards.length - returning;
  return { available: true, totalGuests: cards.length, newGuests, returning, returnRate: cards.length > 0 ? +((returning / cards.length) * 100).toFixed(1) : 0, source: "live" };
}

// --- #20 Employee document reminders (HR) ---
const DOC_DATE_FIELD_PATTERNS = [/medical.*(book|expir)/i, /contract.*(end|expir)/i, /document.*expir/i, /мед.*книжк/i, /договор.*оконч/i];
async function getDocumentReminders(client) {
  const res = await safe(() => client.getEmployees());
  if (!res.ok) return { available: false, requiresModule: "кадровые данные iiko", error: res.error, reminders: [] };
  const items = Array.isArray(res.value) ? res.value : (res.value && res.value.items) || [];
  if (!items.length) return { available: false, requiresModule: "кадровые данные iiko", error: "Справочник сотрудников пуст", reminders: [] };
  const keys = Object.keys(items[0] || {});
  const docField = pickField(keys, DOC_DATE_FIELD_PATTERNS);
  if (!docField) return { available: false, requiresModule: "сроки документов сотрудников в iiko", error: "Поля со сроками документов не найдены в справочнике", reminders: [] };
  const now = Date.now();
  const soon = 30 * 86400000;
  const reminders = items.map((e) => ({ name: [e.lastName, e.firstName].filter(Boolean).join(" ") || e.name || "—", expires: e[docField] })).filter((x) => {
    const t = Date.parse(x.expires);
    return !isNaN(t) && t - now < soon;
  }).sort((a, b) => Date.parse(a.expires) - Date.parse(b.expires));
  return { available: true, reminders, source: "live" };
}

// --- #27 Products nearing expiry (shelf-life) ---
const EXPIRY_FIELD_PATTERNS = [/Expir/i, /ShelfLife/i, /Годн/i, /BestBefore/i];
async function getExpiringProducts(client) {
  const res = await safe(() => getTransactionColumns(client));
  const field = res.ok ? pickField(res.value.names, EXPIRY_FIELD_PATTERNS) : null;
  if (!field) {
    return { available: false, requiresModule: "складской учёт со сроками годности в iiko", error: "Поля со сроками годности нет в складском отчёте", items: [] };
  }
  // Field exists but building a correct expiry query needs install-specific
  // knowledge; surface availability honestly for the operator to wire up.
  return { available: false, requiresModule: "складской учёт со сроками годности", error: "Поле сроков годности обнаружено (" + field + "), но требует настройки под вашу инсталляцию", items: [] };
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
  getRiskyOperations,
  updateEmployeeCredentials,
  getAttendance,
  getGuestAnalytics,
  getAverageCheckAnalytics,
  getAverageCheckTrend,
  getYearOverYear,
  getSalesPlanFact,
  getWorstDishes,
  getDishMargin,
  getCancellationReasons,
  getShiftEfficiency,
  getAttendanceAnomalies,
  getDishRepeats,
  getAbcXyz,
  getMenuEngineering,
  getDishCombos,
  getEmployeeGamification,
  getSimplePnl,
  getRegisterHeatmap,
  getTips,
  getAvgCheckByGuestType,
  getGuestSegmentation,
  getDocumentReminders,
  getExpiringProducts,
};
