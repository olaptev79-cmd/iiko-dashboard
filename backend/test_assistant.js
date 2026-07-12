// Ad-hoc test for the assistant whitelist router (run: node backend/test_assistant.js)
// Guarantees the no-key graceful path and that every whitelisted action maps to
// a real function — no LLM call is made.
delete process.env.ANTHROPIC_API_KEY; // force the "not configured" path deterministically
const assistant = require("./assistant");
let failed = 0;
function ok(name, cond, detail) { if (!cond) failed++; console.log((cond ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + detail : "")); }

(async () => {
  ok("configured() is false without key", assistant.configured() === false);

  const r = await assistant.route("какая сегодня выручка", { fake: true });
  ok("route() degrades gracefully without key", r.available === false && /ANTHROPIC_API_KEY/.test(r.error || ""), JSON.stringify(r).slice(0, 100));

  const actions = assistant.ACTIONS;
  ok("every whitelisted action has a function", Object.values(actions).every((a) => typeof a.fn === "function"));
  ok("whitelist contains expected reports", ["summary", "top_dishes", "pnl", "forecast", "shift_efficiency"].every((k) => k in actions));
  ok("whitelist keys are simple identifiers (closed set)", Object.keys(actions).every((k) => /^[a-z_]+$/.test(k)));

  console.log("\n" + (failed === 0 ? "ALL PASS" : failed + " FAILED"));
  process.exit(failed === 0 ? 0 : 1);
})();
