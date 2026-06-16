require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const svc     = require("./dashboardService");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

const wrap = (fn) => async (req, res) => {
  try   { res.json(await fn(req)); }
  catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
};

app.get("/api/health",      wrap(() => svc.getStatus()));
app.get("/api/dashboard",   wrap(() => svc.getSummary()));
app.get("/api/chart",       wrap((r) => svc.getChart(Number(r.query.days) || 7)));
app.get("/api/top-dishes",  wrap((r) => svc.getTopDishes(Number(r.query.days) || 7)));
app.get("/api/departments", wrap(() => svc.getDepartments()));

app.listen(PORT, () =>
  console.log(`iiko-dashboard backend запущен на порту ${PORT}`)
);
