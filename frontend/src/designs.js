import { initSuite, FEATURES } from "./suite.js";
initSuite();
const ids = { assistant: "01-agent", discover: "02-discover", reader: "03-reader", plans: "04-plans", graph: "05-graph", knowledge: "06-knowledge" };
function render() {
  const f = document.getElementById("design-module").value, t = document.getElementById("design-theme").value, src = `design-assets/${ids[f]}-${t}.png`;
  document.getElementById("design-preview").src = src;
  document.getElementById("design-preview").alt = FEATURES.find((row) => row[0] === f)[1] + (t === "dark" ? "夜间" : "日间") + "设计图";
  document.getElementById("design-download").href = src;
}
document.getElementById("design-module").addEventListener("change", render);
document.getElementById("design-theme").addEventListener("change", render);
