const IikoClient = require("./iikoClient");

const client = new IikoClient(
  process.env.IIKO_URL      || "https://630-539-980.iiko.it",
  process.env.IIKO_LOGIN    || "admin",
  process.env.IIKO_PASSWORD || "12345"
);

const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function todayRange() {
  const d = fmt(new Date());
  return { from: d + " 00:00:00", to: d + " 23:59:59", date: d };
}

function daysRange(n) {
  const now = new Date(), from = new Date(now);
  from.setDate(from.getDate() - n + 1);
  return { from: fmt(from) + " 00:00:00", to: fmt(now) + " 23:59:59" };
}

async function getStatus() {
  const alive = await client.ping();
  return {
    status: alive ? "online" : "offline",
    url: process.env.IIKO_URL || "https://630-539-980.iiko.it",
    login: process.env.IIKO_LOGIN || "admin",
    timestamp: new Date().toISOString(),
  };
}

async function getSummary() {
  const { from, to, date } = todayRange();
  const [olapRes, deptsRes] = await Promise.allSettled([
    client.getOlapSales(from, to),
    client.getDepartments(),
  ]);
  let revenue = 0, orders = 0;
  const byDept = {};
  if (olapRes.status === "fulfilled" && olapRes.value) {
    client.parseOlap(olapRes.value).forEach((r) => {
      const s = parseFloat(r["DishSumInt"] || 0);
      const c = parseInt(r["DishAmountInt"] || 0, 10);
      revenue += s; orders += c;
      const name = r["Department.Name"] || "Прочее";
      if (!byDept[name]) byDept[name] = { revenue: 0, orders: 0 };
      byDept[name].revenue += s;
      byDept[name].orders  += c;
    });
  }
  const deptArr = deptsRes.status === "fulfilled"
    ? (Array.isArray(deptsRes.value) ? deptsRes.value : (deptsRes.value && deptsRes.value.items ? deptsRes.value.items : []))
    : [];
  return {
    date, revenue: +revenue.toFixed(2), orders,
    avgCheck: orders > 0 ? +(revenue / orders).toFixed(2) : 0,
    departmentsCount: deptArr.length,
    byDepartment: Object.entries(byDept).map(([name, v]) => ({
      name, revenue: +v.revenue.toFixed(2), orders: v.orders,
    })).sort((a, b) => b.revenue - a.revenue),
    source: olapRes.status === "fulfilled" ? "live" : "error",
    error: olapRes.status === "rejected" ? olapRes.reason.message : undefined,
  };
}

async function getChart(days = 7) {
  const { from, to } = daysRange(days);
  const olapRaw = await client.getOlapSales(from, to);
  const byDate = {};
  client.parseOlap(olapRaw).forEach((r) => {
    const d = (r["OpenDate.Typed"] || "").slice(0, 10);
    if (!d) return;
    if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0 };
    byDate[d].revenue += parseFloat(r["DishSumInt"] || 0);
    byDate[d].orders  += parseInt(r["DishAmountInt"] || 0, 10);
  });
  const labels = Object.keys(byDate).sort();
  return {
    labels,
    revenue: labels.map((d) => +byDate[d].revenue.toFixed(2)),
    orders:  labels.map((d) => byDate[d].orders),
    source: "live",
  };
}

async function getTopDishes(days = 7) {
  const { from, to } = daysRange(days);
  const olapRaw = await client.getOlapTopDishes(from, to);
  const rows = client.parseOlap(olapRaw);
  rows.sort((a, b) => parseFloat(b["DishSumInt"] || 0) - parseFloat(a["DishSumInt"] || 0));
  return {
    dishes: rows.slice(0, 20).map((r) => ({
      name:     r["Dish.Name"]     || "—",
      category: r["Dish.Category"] || "",
      amount:   parseInt(r["DishAmountInt"] || 0, 10),
      revenue:  +parseFloat(r["DishSumInt"] || 0).toFixed(2),
    })),
    source: "live",
  };
}

async function getDepartments() {
  const data  = await client.getDepartments();
  const items = Array.isArray(data) ? data : (data && data.items ? data.items : []);
  return { departments: items, source: "live" };
}

module.exports = { getStatus, getSummary, getChart, getTopDishes, getDepartments };
